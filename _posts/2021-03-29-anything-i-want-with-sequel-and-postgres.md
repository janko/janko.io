---
title: "Anything I Want With Sequel And Postgres"
tags: sequel
---

At work I was tasked to migrate our time-series analytics data from CSV file
dumps that we've been feeding into Power BI to a dedicated database. Our Rails
app's primary database is currently MariaDB, but we wanted to have our
analytics data in a separate database either way, so this was a good
opportunity to use Postgres which we're most comfortable with anyway.

We're using Active Record for interaction with our primary database, which
gained support for multiple databases in version 6.0. However, given that we
expected the queries to our analytics database would be fairly complex, and
that we'd probably need to be retrieving large quantities of time-series data
(which could be performance-sensitive), I decided it would be a good
opportunity to use [Sequel] instead.

Thanks to Sequel's [advanced Postgres support][sequel postgres], I was able to
utilize many cool Postgres features that helped me implement this task
efficiently. Since not all of these features are common, I wanted to showcase
them in this article, and at the same time demonstrate what Sequel is capable
of. :metal:

## Table partitioning

I mentioned that our analytics data is time-series, which means that we're
storing snapshots of our product data for each day. This results in a large
number of new records every day, so in order to keep query performance at
acceptable levels, I've decided to try out Postgres' [table partitioning]
feature for the first time.

What this feature does is allow you to split data that you would otherwise have
in a single table into multiple tables ("partitions") based on certain
conditions. These conditions most commonly specify a **range** or **list** of
column values, though you can also partition based on **hash** values.
Postgres' query planner then determines which partitions it needs to read from
(or write to) based on the SQL query. This can **drammatically improve
performance** for queries where most partitions have been filtered out during
the query planning phase.

Sequel [supports Postgres' table partitioning][sequel partitioning]
out-of-the-box. In order to create a partitioned table (i.e. a table we can
create partitions of), we need to specify the column(s) we want to partition by
(`:partition_by`), as well as the type of partitioning (`:partition_type`). In
our app, we wanted to have monthly partitions of product data for each client,
so our schema migration contained the following table definition:

```rb
create_table :products, partition_by: [:instance_id, :date], partition_type: :range do
  Date    :date,        null: false
  Integer :instance_id, null: false # in our app "instances" are e-shops
  String  :product_id,  null: false

  # Postgres requires the columns we're partitioning by to be part of the
  # primary key, so we create a composite primary key
  primary_key [:date, :instance_id, :product_id]

  jsonb :data         # general data about the product
  jsonb :competitors  # data about this product from other competitors
  jsonb :statistics   # sales statistics about the product
  jsonb :applied_rule # information about our repricing of the product
end
```

The partitioned table above acts as sort of an abstract table, in the sense
that it won't contain any data by itself, but instead it allows partitions to
be created from it, which will be the ones holding the data. For example, let's
create a partition of this table which will hold data for an e-shop with ID of
`10` for March 2021:

```rb
create_table? :products_10_202103, partition_of: :products do
  from 10, Date.new(2021, 3, 1)
  to 10, Date.new(2021, 4, 1) # this end is excluded from the range
end
```

The arguments we pass to `from` and `to` are the values of columns we've
specified in `:partition_by` on the partitioned table (we have two arguments
because we specified two columns – `:instance_id` and `:date`). The name of the
table partition is custom, in this example I've just chosen a
`products_<INSTANCE_ID>_YYYYMM` naming convention. Given that we're creating
these partitions on-the-fly (as opposed to in a schema migration), I've used
Sequel's `create_table?` to handle the case when the partition already exists,
which generates a `CREATE TABLE IF NOT EXISTS` query.

Once we've created the partitions and populated them with data, we can just
reference the main table in our queries, and Postgres will know which
partition(s) it should direct the queries to.

```rb
# queries partition `products_10_202101`
DB[:products].where(instance_id: 10, date: Date.new(2021, 1, 1)).to_a

# queries partitions `products_29_202102` and `products_29_202103`
DB[:products].where(instance_id: 29, date: Date.new(2021, 2, 1)..Date.new(2021, 3, 31)).to_a

# creates the record in partition `products_13_202012`
DB[:products].insert(instance_id: 13, date: Date.new(2020, 12, 25), product_id: "abc123", ...)
```

## Upserts

We have 4 types of product data, each of which is retrieved, aggregated, and
stored in a separate background job. Previously, each background job was
writing to a separate CSV file, but now they would all be writing to a single
table, either creating new records or updating existing records with new data.

The simplest option which is also concurrency-safe was to use Postgres' `INSERT
... ON CONFLICT ...`, also known as "upsert". Sequel supports upserts with
all its parameters via [`#insert_conflict`][sequel upsert]:

```rb
DB[:products]
  .insert_conflict # by default ignores insert that fails unique constraint violation
  .insert(instance_id: 10, date: Date.new(2021, 1, 1), product_id: "abc123")

# INSERT INTO products (instance_id, date, product_id)
# VALUES (10, '2021-01-01', 'abc123')
# ON CONFLICT DO NOTHING
```

In my task, I needed each background job to only store data it is responsible
for, and that these jobs can be executed in any order. So, the background job
which was responsible for storing general product data into the analytics
database had the following code:

```rb
product_data #=>
# [
#   { instance_id: 10, date: Date.new(2021, 1, 1), product_id: "111", data: { ... } },
#   { instance_id: 10, date: Date.new(2021, 1, 1), product_id: "222", data: { ... } },
#   { instance_id: 10, date: Date.new(2021, 1, 1), product_id: "333", data: { ... } },
#   ...
# ]

product_data.each_slice(1000) do |values|
  DB[:products]
    .insert_conflict(
      target: [:date, :instance_id, :product_id],
      update: { data: Sequel[:excluded][:data] }
    )
    .multi_insert(values)
end

# INSERT INTO products (...) VALUES (...)
# ON CONFLICT (date, instance_id, product_id) DO UPDATE data = excluded.data
```

The above inserts values in batches of 1,000 records, and when the record
already exists, only the `data` column value is replaced. In general, when a
conflict happens, Postgres exposes the values we've tried to insert under the
`excluded` qualifier. So, in the `DO UPDATE` clause we were able to do `data =
excluded.data`, which updates only the `data` column. In this case, Postgres
also requires us to specify the column(s) involved in the unique index, which
in our case are `date`, `instance_id`, and `product_id` that form the primary
key.

## COPY

Now that we've covered the important bits involved in modifying the code to
write new data into Postgres, what remains is efficiently migrating all the
historical data from our CSV files into Postgres.

The fastest way to import CSV data into a Postgres table is using `COPY FROM`,
which Sequel supports via [`#copy_into`][sequel copy]:

```rb
DB.copy_into :records,
  format: "csv",
  options: "HEADERS true",
  data: File.foreach("records.csv")
```

In my case, I couldn't import the CSV files directly into the `products`
table, because I wanted to write most of the fields into JSONB columns. So I
first imported the CSV data into a temporary table whose columns matched the
CSV data, and then copied the data from that table into the end `products`
table in the desired format.

```rb
data = File.foreach("products_10.csv")
columns = File.foreach("products_10.csv").first.chomp.split(",")
temp_table = :"products_#{SecureRandom.hex}"

DB.create_table temp_table do
  columns.each do |column|
    String column.to_sym
  end
end

DB.copy_into temp_table, format: "csv", options: "HEADERS true", data: data

DB[temp_table].paged_each.each_slice(1000) do |products|
  DB[:products].insert products.map { |product| ... } # transform into desired format
end

DB.drop_table temp_table
```

## Inserting from SELECT

Notice how in the last example we were fetching data from the temporary
table, transforming it in Ruby, then writing the result in batches into the
destination table. This is a common way people copy data, but it's actually
pretty inefficient, both in terms of memory usage and speed.

What we can do instead is transform the data via a `SELECT` statement, and then
pass it directly to `INSERT`. This way we avoid retrieving any data on the
client side, and we allow Postgres to determine the most efficient way to copy
the data.

```sql
INSERT INTO my_table (col1, col2, col3, ...)
SELECT val1, val2, val3, ... FROM another_table WHERE ...
```

Sequel's [`#insert`][sequel insert] method supports this feature by accepting a
dataset object:

```rb
DB[:products].insert [:instance_id, :date, :product_id, :data], DB[temp_table].select(...)
```

I've covered this topic in more depth in [my recent article][insert from
select], which includes a [benchmark][insert from select benchmark]
illustrating the performance benefits of this approach.

## Unlogged tables

Lastly, writing data into a temporary table does create some overhead, which
we can reduce by making the temporary table "unlogged". With this setting, data
written to this table is not written to Postgres' write-ahead log (used for
crash recovery), which makes the writing speed considerably faster than in
ordinary tables.

Sequel allows creating unlogged tables by passing the `:unlogged` option to
`#create_table`:

```rb
DB.create_table temp_table, unlogged: true do
  # ...
end
# CREATE UNLOGGED TABLE products_5ea6fe37d2fde562 (...)
```

## Loose count

During this migration, I've often wanted to check the total number of records,
to verify that the migration was performed for all of our customers. The
problem is that the regular `SELECT count(*) ...` query can be slow for larger
amounts of records.

```rb
# can take some time:
DB[:products].where(instance_id: 10).count
# SELECT count(*) FROM products WHERE instance_id = 10
```

Luckily, Postgres stores a rough number of records for each table, which can
be retrieved very fast, and in my case that was more than sufficient. I
wouldn't have found about this Postgres feature if I hadn't come across
Sequel's [pg_loose_count][sequel loose count] extension:

```rb
DB.extension :pg_loose_count
DB.tables
  .grep(/products_10_.+/) # select only partitions for e-shop with ID of 10
  .sum { |partition| DB.loose_count(partition) } # fast count
```

## Conclusion

With Sequel and Postgres I was able to use table partitioning to store
time-series data in a way that's efficient to query, import large amounts of
historical data from CSV files into a temporary unlogged table, and transform
it and write it into the destination table all in SQL, while checking the data
migration progress with Postgres' loose record counts.

All these Postgres features helped me to efficiently handle time-series data
and import historical data, and I didn't have to make any comporomises, thanks
to Sequel supporting me every step of the way.

[Sequel]: https://github.com/jeremyevans/sequel
[sequel postgres]: http://sequel.jeremyevans.net/rdoc/files/doc/postgresql_rdoc.html
[table partitioning]: https://www.postgresql.org/docs/current/ddl-partitioning.html
[sequel partitioning]: http://sequel.jeremyevans.net/rdoc/files/doc/postgresql_rdoc.html#label-Creating+Partitioned+Tables
[sequel upsert]: http://sequel.jeremyevans.net/rdoc/files/doc/postgresql_rdoc.html#label-INSERT+ON+CONFLICT+Support
[sequel copy]: http://sequel.jeremyevans.net/rdoc-adapters/classes/Sequel/Postgres/Database.html#method-i-copy_into
[sequel insert]: http://sequel.jeremyevans.net/rdoc/classes/Sequel/Dataset.html#method-i-insert
[insert from select]: /inserting-from-datasets-with-sequel/
[insert from select benchmark]: /inserting-from-datasets-with-sequel/#measuring-performance
[sequel loose count]: http://sequel.jeremyevans.net/rdoc-plugins/files/lib/sequel/extensions/pg_loose_count_rb.html
