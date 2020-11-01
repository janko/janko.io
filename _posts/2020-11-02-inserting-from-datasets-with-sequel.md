---
title: "Inserting from Datasets with Sequel"
---

At a previous company, I was working on an internal app for managing and
distributing video content. Content curators would create playlists of videos,
submit them for approval, and once playlists were approved they would be
automatically published to target devices.

Both the approval and the publishing flows consisted of multiple steps, so we
were creating logs for these events and storing them in PostgreSQL. We were
using [Sequel] for database interaction, and our logs table looked roughly like
this:

```rb
create_table :activity_logs do
  primary_key :id
  foreign_key :playlist_id, :playlists, null: false
  foreign_key :user_id, :users
  String :event, null: false
  String :action, null: false
  String :message
  String :target
  Time :created_at, null: false, default: Sequel::CURRENT_TIMESTAMP
end
```

The table was populated with log records that looked like this:

```rb
[
  ...,
  {
    id:          23,
    playlist_id: 103,
    user_id:     30,
    event:       "approval",
    action:      "approve",
    message:     "Looks good!",
    target:      nil,
    created_at:  Time.utc(2020, 10, 1, 5, 29, 39),
  },
  {
    id:          25,
    playlist_id: 423,
    user_id:     nil,
    event:       "publication",
    action:      "published",
    message:     nil,
    target:      "Video Wall 1",
    created_at:  Time.utc(2020, 10, 1, 7, 38, 11),
  },
  ...
]
```

What we eventually realized was that we're actually storing *two* types of
records in the same table, where not all columns are applicable to both types:

* the **approval flow**, done by a person (uses `user_id` and `message` columns), and
* the **publication flow**, is done by the system (uses `target` column).

Instead storing both types of events in the `activity_logs` table, we've
decided to extract the publication logs into a new `publication_logs` table.

## 1. Creating the new table

We've started by creating our desired `publication_logs` table:

```rb
create_table :publication_logs do
  primary_key :id
  foreign_key :playlist_id, :playlists, null: false
  String :action, null: false
  String :target
  Time :created_at, null: false, default: Sequel::CURRENT_TIMESTAMP
end
```

We've ommitted the `event` column from `activity_logs`, as well
`user_id` and `message`, since they were only applicable for approval
actions done by a person (publication is done automatically by our
system).

Next up was migrating the existing publication logs from the `activity_logs`
table into the new `publication_logs` table.

## 2a. Migrating records one by one

The easiest approach of migrating data would be looping through each record,
transforming the record into the desired format, and inserting it into the new
table, then deleting the data from the old table.

```rb
# select records we want to move
publication_logs = from(:activity_logs).where(event: "publication")

# insert each record individually into the new table
publication_logs.each do |log|
  from(:publication_logs).insert(
    playlist_id: log[:playlist_id],
    action:      log[:action],
    target:      log[:target],
    created_at:  log[:created_at],
  )
end

# delete records from the old table
publication_logs.delete
```

We can gain an additional performance improvement here if we switch to using
[prepared statements] for the inserts:

```rb
# select records we want to move
publication_logs = from(:activity_logs).where(event: "publication")

prepared_insert = from(:publication_logs).prepare :insert, :insert_publication_data,
  playlist_id: :$playlist_id, action: :$action, target: :$target, created_at: :$created_at

# insert each record individually into the new table
publication_logs.each do |log|
  prepared_insert.call(
    playlist_id: log[:playlist_id],
    action:      log[:action],
    target:      log[:target],
    created_at:  log[:created_at],
  )
end

# delete records from the old table
publication_logs.delete
```

This strategy would usually perform well enough on small to medium tables, but
it so happens ours was a logs table with lots of records (about 200,000 IIRC).
Since long-running migrations can generally be problematic, let's find a better
approach.

## 2b. Migrating records in bulk

Most SQL databases support inserting multiple records in a single query, which
is significantly faster. In PostgreSQL, the syntax looks like this:

```sql
INSERT INTO my_table (col1, col2, col3, ...)
VALUES ('a1', 'b1', 'c1', ...),
       ('a2', 'b2', 'c2', ...),
       ...
```

With Sequel, we can utilize the multi-insert feature via [`#import`][#import],
which accepts the list of columns as the 1st argument, and the arrays of values
as the 2nd argument:

```rb
# select the records we want to move
publication_logs = from(:activity_logs).where(event: "publication")

# insert all new data in a single query
from(:publication_logs).import [:playlist_id, :action, :target, :created_at],
  publication_logs.map { |log| log.fetch_values(:playlist_id, :action, :target, :created_at) }

# delete records from the old table
publication_logs.delete
```

This already provides a big improvement in terms of speed. However, one problem
here is that we're loading all the data into memory before inserting it, which
can spike our memory usage. Furthermore, inserting so many records at once can
put significant load on the database.

To fix both issues, we can break the multi-insert down into smaller batches:

```rb
# select the records we want to move
publication_logs = from(:activity_logs).where(event: "publication")

# bullk-insert new records in batches
publication_logs.each_slice(1000) do |logs|
  from(:publication_logs).import [:playlist_id, :action, :target, :created_at],
    logs.map { |log| log.fetch_values(:playlist_id, :action, :target, :created_at) }
end

# delete records from the old table
publication_logs.delete
```

## 2c. Migrating records in the database

While the previous approach should work well enough for most cases, retrieving
data from the database only to send it back slightly modified does seem a bit
wasteful. Wouldn't it be great if we could do all of that on the database side?

It turns out we can. Typically, we use an `INSERT` statement by passing it raw
values. However, an `INSERT` statement can also receive values directly from a
`SELECT` statement:

```sql
INSERT INTO my_table (col1, col2, col3, ...)
SELECT a1, b1, c1, ... FROM other_table WHERE ...
```

In Sequel, the `#import` method supports this feature by accepting a dataset
object in place of raw values. This allows us to rewrite our migration one last
time:

```rb
# select the records we want to move
publication_logs = from(:activity_logs).where(event: "publication")

# form a dataset with the new data and insert from that dataset
from(:publication_logs).import [:playlist_id, :action, :target, :created_at],
  publication_logs.select(:playlist_id, :action, :target, :created_at)

# delete records from the old table
publication_logs.delete
```

## 3. Removing old columns

What's left was removing columns that were specific to publication from the
`activity_logs` table:

```rb
alter_table :activity_logs do
  drop_column :event           # this table will only hold approval logs now
  drop_column :target          # this was specific to publication logs
  set_column_not_null :user_id # only publication logs didn't have user id set
end
```

## Measuring performance

I've created a [script] which populates the `activity_logs` table with 100,000
approval logs and 100,000 publication logs, and measures execution time and
memory allocation of all 5 migration strategies we've talked about (database is
PosgreSQL 12).

Here are the results:

| Strategy                    | Duration       | Objects allocated | Memory allocated  |
| :------                     | -------------: | ----------------: | ----------------: |
| individual inserts          | 35.7 s         | 610k              | 478 MB            |
| individual prepared inserts | 23.8 s         | 480k              | 634 MB            |
| bulk insert                 | 8.4 s          | 21k               | 162 MB            |
| batched bulk insert         | 7.9 s          | 21k               | 158 MB            |
| database insert             | 2.0 s          | 94                | 0 MB              |

As expected, inserting records individually is the slowest strategy. I was a
bit surprised to see that it's allocating significantly more memory than the
bulk insert strategy, but I believe it's because we're allocating hashes for
each record, while with bulk inserts we're allocating value arrays. It's nice
to see that prepared statements provided a ~33% speedup, though at a cost
of increased memory usage.

For bulk inserts, I expected the batching variant to be slower, because I
imagined that we're trading off speed for reduced load. But I'm positively
surprised that it performs at least as fast as the non-batched version.

Inserting from a dataset performed the best, since there the database does all
the work. In our case it was **4x faster** than the bulk insert strategy. It
allocates zero additional memory on the application side, because everything is
happening on the database side.

## Closing thoughts

For the past several years, I've become more and more interested in finding
ways to make the database do the majority of the work I need, especially since
I've started using Sequel. I love that Sequel allows me to do anything I want
without compromises.

We've compared the performance of migrating records (a) individually, (b) in
bulk, and (c) from a dataset. Inserting from a dataset was by far the fastest
strategy, and the code wasn't any more complex than the other strategies.

This article showed a fairly simple scenario, in many cases our data migrations
might require more complex data transformations. In this case it's tempting to
just do the transformations in Ruby, as we know Ruby much better than SQL.
However, I think that learning some common SQL functions can come a long way in
being able to make your database do the work.

[Sequel]: https://github.com/jeremyevans/sequel
[#import]: http://sequel.jeremyevans.net/rdoc/classes/Sequel/Dataset.html#method-i-import
[prepared statements]: http://sequel.jeremyevans.net/rdoc/files/doc/prepared_statements_rdoc.html
[script]: https://gist.github.com/janko/99e2196b7af178dc01474b51cd72b5de
