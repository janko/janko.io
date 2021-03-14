---
title: "Anything I Want With Sequel And Postgres"
tags: sequel
---

At work I was tasked to migrate our time-series analytics data from CSV file
dumps that we've been feeding into Power BI to a dedicated database. Our Rails
app's primary database is currently MariaDB, but we wanted to have our
analytics data in a separate database either way, so this was a good
opportunity to use Postgres which we're the most comfortable with anyway.

We're using Active Record for interaction with our primary database, and Active
Record gained support for multiple databases in version 6.0. However, given
that we expected the queries to our analytics database would be fairly complex,
and that we'd probably need to be retrieving large quantities of time-series
data (which could be performance-sensitive), I decided it would be a good
opportunity to use [Sequel] instead.

Thanks to Sequel's [advanced Postgres support][sequel postgres], I was able to
utilize many cool Postgres features that helped me implement this task
efficiently. In this article I wanted to teach you about some of those
features, and at the same time show you what Sequel is capable of. :metal:

## Table partitioning

I mentioned that our analytics data is time-series, which means that we're
storing snapshots of our product data for each day. This results in a large
number of new records every day (at the time of writing we have 62M records in
total), so in order to keep query performance at acceptable levels, I've
decided to try out Postgres' [table partitioning] feature for the first time.

What this feature does is allow you to split data that you would otherwise have
in a single table into multiple tables ("partitions") based on certain
conditions. These conditions are most commonly specified as a **range** or
**list** of column values, though you can also partition based on **hash**
values. Postgres' query planner then determines which partitions it needs to
read from (or write to) based on the SQL query. This can **drammatically improve
performance** for queries where most partitions have been filtered out during
the query planning phase.

Sequel [supports Postgres' table partitioning][sequel partitioning]
out-of-the-box. In order to create a partitioned table (i.e. a table we can
create partitions of), we need to specify the column(s) we want to partition by
(`:partition_by`) as well as the type of partitioning (`:partition_type`). In
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
be created from it, which will be the ones holding the data. As an example,
let's create a partition of this table which will hold data for an e-shop with
ID of `10` for March 2021:

```rb
create_table? :products_10_202103, partition_of: :products do
  from 10, Date.new(2021, 3, 1)
  to 10, Date.new(2021, 4, 1) # this value is excluded from the range
end
```

The arguments we pass to `from` and `to` are the values of columns we've
specified in `:partition_by` on the partitioned table (we have two arguments
because we specified two columns – `:instance_id` and `:date`). The name of the
table partition is custom, I've just decided to use the
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
various parameters via [`#insert_conflict`][sequel upsert]:

```rb
DB[:products]
  .insert_conflict # by default ignores insert that fails unique constraint violation
  .insert(instance_id: 10, date: Date.new(2021, 1, 1), product_id: "abc123")

# INSERT INTO products (instance_id, date, product_id)
# VALUES (10, '2021-01-01', 'abc123')
# ON CONFLICT DO NOTHING
```

In my task, I needed each background job to only store data it is responsible
for, and that the order in which this jobs are executed doesn't matter. So, the
background job which was responsible for storing general product data into the
analytics database had the following code:

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
already exists, only the `data` column value is replaced. When a conflict
happens, Postgres exposes the values we've tried to insert via `excluded`,
where `excluded.data` retrieves the value of `data` column, so in the `DO
UPDATE` clause we could have `data = excluded.data` to update only the `data`
column. In this case, Postgres also requires us to specify the column(s)
involved in the unique index, which in our case are `date`, `instance_id`, and
`product_id` that form the primary key.

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
columns = File.foreach("products_10.csv")[0].chomp.split(",")
temp_table = :"products_#{SecureRandom.hex}"

DB.create_table temp_table do
  columns.each do |column|
    String column.to_sym
  end
end

DB.copy_into temp_table, format: "csv", options: "HEADERS true", data: data

DB[:products].insert DB[temp_table].where(...).select(...)

DB.drop_table temp_table
```

## Inserting from SELECT

## Unlogged tables

To minimize the overhead of writing data into the temporary table first, we
can make the temporary table "unlogged". Data written to unlogged tables is
not written to Postgres' write-ahead log (WAL), which makes the writing speed
considerably faster than in ordinary tables.

Sequel allows creating unlogged tables by specifying the `:unlogged` option:

```rb
DB.create_table temp_table, unlogged: true do
  # ...
end
# CREATE UNLOGGED TABLE products_5ea6fe37d2fde562 (...)
```

## Loose count

## Conclusion

[Sequel]: https://github.com/jeremyevans/sequel
[sequel postgres]: http://sequel.jeremyevans.net/rdoc/files/doc/postgresql_rdoc.html
[table partitioning]: https://www.postgresql.org/docs/current/ddl-partitioning.html
[sequel partitioning]: http://sequel.jeremyevans.net/rdoc/files/doc/postgresql_rdoc.html#label-Creating+Partitioned+Tables
[sequel upsert]: http://sequel.jeremyevans.net/rdoc/files/doc/postgresql_rdoc.html#label-INSERT+ON+CONFLICT+Support
[sequel copy]: http://sequel.jeremyevans.net/rdoc-adapters/classes/Sequel/Postgres/Database.html#method-i-copy_into
