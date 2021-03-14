---
title: "Anything I Want With Sequel And Postgres"
tags: sequel
---

At work I've been tasked to migrate our time-series analytics data from CSV
file dumps that we've been feeding into Power BI to a dedicated Postgres
database. Our Rails app's primary database is currently MariaDB, but we wanted
to have our analytics data in a separate database either way, so this was a good
opportunity to use Postgres which we're the most comfortable with anyway.

Now, we're using Active Record for interaction with our primary database, and
Active Record gained support for multiple databases in version 6.0. However,
given that the queries to our analytics database would likely be fairly
complex, that we'd probably need to be retrieving large quantities of
time-series data in a performant way, I decided it would be a good opportunity
to use [Sequel] instead.

What was interesting for me about this task is that we've ended up using many
of Postgres' cool features, all of which Sequel had first-class support for.
So, in this article I want to teach you about those features, and at the same
time show you what Sequel is capable of.

## Table partitioning

I mentioned that our analytics data is time-series, which means we're storing
snapshots of important data for each day. This results in the number of records
growing linearly every day (we're at 62M at the time of writing), so in order
to keep query performance at acceptable levels, I've decided to try out
Postgres' [table partitioning] feature for the first time.

What this feature does is allow you to split data that you would otherwise have
in a single table into multiple tables ("partitions") based on certain
conditions. It's most common to have these conditions specify a **range** or
**list** of column values, though there is also partitioning based on **hash**
values. Postgres' query planner then determines which partitions it needs to
read from (or write to) depending on the SQL query. This can **drammatically
improve performance** for queries where most partitions have been filtered out
during the query planning phase.

Sequel [supports Postgres' table partitioning][sequel partitioning]
out-of-the-box. In order to turn on table partitioning, we need to pass the
following options when creating the main table:

* `:partition_by` – column(s) we want to partition by
* `:partition_type` – type of partitioning (`:range`, `:list`, or `:hash`)

In our app, we wanted to have monthly partitions for each client, so our schema
migration contained the following table definition:

```rb
create_table :products, partition_by: [:instance_id, :date], partition_type: :range do
  Date    :date,        null: false
  Integer :instance_id, null: false # in our app "instances" are e-shops
  String  :product_id,  null: false

  # Postgres requires the columns we're partitioning by to be part of the
  # primary key, so we create a composite primary key
  primary_key [:date, :instance_id, :product_id]

  # data about the products we were storing
  jsonb :data
  jsonb :competitors
  jsonb :statistics
  jsonb :applied_rule
end
```

Partitioned tables act as sort of abstract tables, in the sense that they
won't contain any data by itself, but instead they act as a blueprint for
creating partitions which will actually hold the data. As an example, let's
create a partition of this table which will hold data for an e-shop with ID of
`10` for March 2021:

```rb
create_table? :products_10_202103, partition_of: :products do
  from 10, Date.new(2021, 3, 1)
  to 10, Date.new(2021, 4, 1) # this value is excluded from the range
end
```

The arguments we pass to `from` and `to` are the values of columns we've
specified in `:partition_by` on the partitioned table (we have two arguments
because we specified two columns). The name of the table partition is
completely custom, I've just decided to use the `products_<INSTANCE_ID>_YYYYMM`
naming convention. Given that we're creating these partitions on-the-fly (as
opposed to in a schema migration), I've used Sequel's `create_table?` to handle
the case when the partition already exists, which generates a `CREATE TABLE IF
NOT EXISTS` query.

## Upserts

We've had 4 different types of data we wanted to insert into the same table.
Using upserts

## COPY

## Unlogged tables

## Inserting from SELECT

## Loose count

[Sequel]: https://github.com/jeremyevans/sequel
[table partitioning]: https://www.postgresql.org/docs/current/ddl-partitioning.html
[sequel partitioning]: http://sequel.jeremyevans.net/rdoc/files/doc/postgresql_rdoc.html#label-Creating+Partitioned+Tables
