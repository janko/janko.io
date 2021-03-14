---
title: "Anything I Want With Sequel And Postgres"
tags: sequel
---

At work I've been tasked to switch our analytics data that we feed into Power
BI dashboards from CSV file dumps into a dedicated Postgres database. Ours is a
classic Rails app, with MariaDB as the main database and Active Record to
interact with it.

Given that we'd be using a new database, and that the workflow would likely
require complex SQL queries and other performant ways of dealing with large
quantities of data, I thought it would be a good idea to use [Sequel] for this.

Initially we gave Active Record a shot, given that we're already using it for
our main database, and given that Active Record supports multiple databases
since version 6.0. However, in the end it didn't support too many features that
we needed, and we also already knew it would have suboptimal performance
compared to Sequel, so we decided it simply wasn't the right tool for this job.

For my task, we've ended up using many cool Postgres features, which Sequel
enabled us. And I want to share it with you.

## Table partitioning

Since our analytics data is time-series, to keep the performance at acceptable
levels I've decided to use Postgres' [table partitioning] feature. This feature
has the potential to significantly reduce the amount of data it queries over
on how good our partitioning strategy is, this feature has the potential to
significantly reduce the amount of data it queries over during the query
planning phase, speeding up SELECTs significantly.

<!-- I admit that I heard about [TimescaleDB] only after implementing partitioning -->
<!-- myself. It would probably be faster than anything I would come up with, but I'm -->
<!-- still glad to start our with native Postgres features, and migrate to something -->
<!-- more complex only if needed. -->

## Upserts

We've had 4 different types of data we wanted to insert into the same table.
Using upserts

## COPY

## Unlogged tables

## Inserting from SELECT

## Loose count

[Sequel]: https://github.com/jeremyevans/sequel
[table partitioning]: https://www.postgresql.org/docs/current/ddl-partitioning.html
[TimescaleDB]: https://www.timescale.com/
