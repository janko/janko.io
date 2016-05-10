---
layout: post
title: Benefits of Not Using Rails
author: janko
tags: ruby web rails framework
---

There's no doubt that Rails is still by far the most popular Ruby web
framework, and very much alive with Rails 5 just around the corner. But let's
not pretend that Rails is the only relevant web framework in Ruby. It's not,
people are using other web frameworks *a lot*, for different use cases. Let's
mention some:

* **[Sinatra]** -- TODO
* **[Roda]** -- Provides a powerful router that allows you to mix request
  handling with routing for better organized and DRY-er code, and is packed
  with many advanced features.
* **[Grape]** -- A framework specialized for building REST-like APIs, ships
  with params validation, API versioning, RESTful object representations, API
  documentation and much more.
* **[Hanami] \(formerly Lotus\)** -- Leightweight version of Rails, aims to
  apply better OO principles and define clearer boundaries between parts of
  the system, and provide the best performance.
* **[Webmachine]** -- Allows you to define your HTTP API at a more precise
  level, motivating you to use proper HTTP codes and responses for various
  situations.
* **[Volt]** -- Allows you write isomorphic apps by writing Ruby code both on
  server and client (via [Opal]), and features things like automatic page
  synchronization and fast DOM updates.
* ....

ActiveRecord isn't alone either:

* **[Sequel]** -- Features a really advanced query interface, has support for
  many advanced database features (views, functions, triggers, sharding etc),
  as well as many PostgreSQL-specific features (JSON, array, UPSERT, COPY,
  cursors, LISTEN/NOTIFY, concurrent indices etc), and is [very fast].
* **[ROM]** -- The Yang to the ActiveRecord pattern, applies proper OO design
  principles and maintains a clear separation of concerns, aiming to help
  interacting with the database in a more maintainable way.
* **[Mongoid]** -- An ODM (Object-Document-Mapper) for MongoDB.
* ...

## 1. Simplicity

* source code

## 2. Modularity

[Hanami]: http://hanamirb.org
[Roda]: https://github.com/jeremyevans/roda
[Grape]: https://github.com/ruby-grape/grape
[Webmachine]: https://github.com/webmachine/webmachine-ruby
[Volt]: https://github.com/voltrb/volt
[Opal]: https://github.com/opal/opal
[very fast]: https://github.com/jeremyevans/simple_orm_benchmark
[Sequel]: https://github.com/jeremyevans/sequel
[ROM]: http://rom-rb.org
[Mongoid]: https://github.com/mongodb/mongoid
