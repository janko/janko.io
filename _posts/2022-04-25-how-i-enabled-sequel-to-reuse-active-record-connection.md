---
title: How I Enabled Sequel to Reuse Active Record's Database Connection
tags: sequel
---

When I started developing the [Rails integration for Rodauth][rodauth-rails], one of the first problems I needed to solve was how to make Rodauth work seamlessly with Active Record, given that it uses [Sequel] for database interaction. I believed these two could coexist together, because Sequel is mostly hidden from the Rodauth user anyway, and all that really matters is that Rodauth's SQL statements get executed on the database.

My first approach was to have Sequel connect to the same database as Active Record, and create and close connections in [lockstep with Active Record][lockstep], so that Sequel is connected to the database if and only if Active Record is too. While this was functional, it didn't play well with transactions. Some of Rodauth's configuration blocks are executed within a Sequel transaction, and I wanted developers to be able to call Active Record inside them, and have it just work. But this wasn't the case, because it turns out, if you have two different connections, they aren't aware of each other's transactions; you might as well be using two different processes.

```rb
ActiveRecord::Base.establish_connection("postgresql:///mydb")
DB = Sequel.connect("postgresql:///mydb")

class Account < Sequel::Model
end
class Profile < ActiveRecord::Base
end

# open sequel transaction
DB.transaction do
  # create record using sequel connection
  account = Account.create(email: "user@example.com", password_hash: "...")

  # open active record transaction
  ActiveRecord::Base.transaction do
    # create associates record using active record connection
    Profile.create(name: "User", account_id: account.id)
    #~> foreign key constraint violation: given account_id is not present in table "accounts"
  end
end
```

The example above fails because, while the account record was created by Sequel's connection, its transaction hasn't yet been committed at the time Active Record's connection attempted to create the associated profile record. Even though Active Record's transaction block is physically nested inside Sequel's, transactions are tied to connections that opened them, so as far as the database is concerned these are two independent transactions.

Moreover, if Sequel did use its own database connection, that would mean the number of open connections to the database would double, which could impact performance and hit maximum connection limits. So, I knew I needed to find a way to make Sequel reuse Active Record's database connection instead of creating its own.

I decided to build this as a [database extension] for Sequel, which when loaded, switches Sequel to use Active Record's database connection:

```rb
class Sequel
  class ActiveRecordConnection
    # ... database overrides ...
  end

  Database.register_extension(:activerecord_connection, ActiveRecordConnection)
end
```
```rb
DB = Sequel.connect(...)
DB.extension :activerecord_connection
DB.run "SELECT ..." # executed on Active Record's database connection
```

## Reusing the connection

Sequel's connection pool is the one in charge of creating new database connections when they're needed. So, the first and most important step was to bypass it, and retrieve Active Record's database connection instead.

The Sequel connection is retrieved in `Database#synchronize`, which gets called for every query, so that's the ideal place to put the override:

```rb
class Sequel::ActiveRecordConnection
  def synchronize(*)
    yield activerecord_connection.raw_connection
  end

  private

  def activerecord_connection
    ActiveRecord::Base.connection
  end
end
```
```rb
DB.synchronize do |connection|
  connection # Active Record's connection object
end
```

I also needed to account for the fact that Sequel adapters use different connection options than Active Record, and store prepared statements in the connection object. For [SQLite] and [MySQL] handling this required relatively little code, while for [PostgreSQL] I unfortunately needed to copy-paste methods defined on Sequel adapter's subclass of `PG::Connection`.

## Syncing transaction state

Both Sequel and Active Record track which transactions are in progress and in which order. Currently, even though the connection is shared, Sequel doesn't know about transactions opened by Active Record and vice-versa.

```rb
DB.transaction do
  ActiveRecord::Base.connection.open_transactions #=> 0
end

ActiveRecord::Base.transaction do
  DB.in_transaction? #=> false
end
```

Syncing this state is important for handling nested transaction blocks, which should either reuse the outer transaction or use a savepoint, depending on the setup. Sequel saves informations about transactions for each connection in `@transactions` instance variable:

```rb
DB.transaction(auto_savepoint: true) do |conn|
  DB.instance_variable_get(:@transactions)[conn] #=> {savepoints: [{auto_savepoint: true}]}

  DB.transaction do # creates a savepoint
    DB.instance_variable_get(:@transactions)[conn] #=> {savepoints: [{auto_savepoint: true}, {auto_savepoint: nil}]}
  end
end
```

We'll override the method accessing this instance variable, and sync state about any transactions opened by Active Record:

```rb
class Sequel::ActiveRecordConnection
  # ...
  private

  def _trans(conn)
    hash = super || { savepoints: [], activerecord: true }

    # add any transactions/savepoints opened via Active Record
    while hash[:savepoints].length < activerecord_connection.open_transactions
      hash[:savepoints] << { activerecord: true }
    end
    # remove any transactions/savepoints closed via Active Record
    while hash[:savepoints].length > activerecord_connection.open_transactions && hash[:savepoints].last[:activerecord]
      hash[:savepoints].pop
    end
    # sync knowledge about joinability of current Active Record transaction/savepoint
    if activerecord_connection.transaction_open? && !activerecord_connection.current_transaction.joinable?
      hash[:savepoints].last[:auto_savepoint] = true
    end

    if hash[:savepoints].empty? && hash[:activerecord] # Active Record closed last transaction
      Sequel.synchronize { @transactions.delete(conn) }
    else
      Sequel.synchronize { @transactions[conn] = hash }
    end

    super
  end
  # ...
end
```
```rb
ActiveRecord::Base.transaction(requires_new: true) do
  DB.in_transaction? #=> true
  DB.transaction do
    DB.send(:in_savepoint?) #=> true
  end
end
```

This takes care of Sequel state, now we need to ensure that Active Record's state is updated when opening transactions via Sequel. We can do this by calling Active Record for beginning, committing, and rolling back transactions:

```rb
class Sequel::ActiveRecordConnection
  # ...
  private

  def begin_transaction(conn, opts = OPTS)
    activerecord_connection.begin_transaction(joinable: !opts[:auto_savepoint])
  end

  def commit_transaction(conn, opts = OPTS)
    activerecord_connection.commit_transaction
  end

  def rollback_transaction(conn, opts = OPTS)
    activerecord_connection.rollback_transaction
  end
  # ...
end
```
```rb
DB.transaction(auto_savepoint: true) do
  ActiveRecord::Base.connection.open_transactions #=> 1
  ActiveRecord::Base.transaction do
    ActiveRecord::Base.connection.open_transactions #=> 2
  end
end
```

## Fixing transaction hooks

Because we've preserved the format of transaction state, Sequel's after commit/rollback hooks still work when Sequel holds the outer transaction:

```rb
DB.transaction do
  DB.after_commit { puts "=> after commit" }
  DB.after_rollback { puts "=> after rollback" }
  DB.run "SELECT 1"
end
# BEGIN
# SELECT 1
# COMMIT
# => after commit
```

However, they don't work when Active Record holds the outer transaction, because in that case Active Record is the one committing the transaction, and Sequel doesn't get notified.

```rb
ActiveRecord::Base.transaction do
  DB.after_commit { puts "doesn't get called" }
  DB.run "SELECT 1"
end
# BEGIN
# SELECT 1
# COMMIT
```

We can fix this by using the [after_commit_everywhere] gem to register after commit/rollback callbacks into Active Record when it holds the outer transaction. Sequel will call either `#add_transaction_hook` or `#add_savepoint_hook` method, depending on whether the hook was registered within a transaction or a savepoint, so we'll override those:

```sh
$ gem install after_commit_everywhere
```
```rb
require "after_commit_everywhere"

class Sequel::ActiveRecordConnection
  # ...
  private

  def add_transaction_hook(conn, type, block)
    if _trans(conn)[:activerecord] # Active Record holds the outer transaction
      AfterCommitEverywhere.public_send(type, &block)
    else
      super
    end
  end

  def add_savepoint_hook(conn, type, block)
    if _trans(conn)[:savepoints].last[:activerecord] # Active Record holds the savepoint
      AfterCommitEverywhere.public_send(type, &block)
    else
      super
    end
  end
  # ...
end
```
```rb
ActiveRecord::Base.transaction do
  DB.after_commit { puts "=> gets called" }
  DB.run "SELECT 1"
end
# BEGIN
# SELECT 1
# COMMIT
# => gets called
```

## Instrumenting SQL queries

Active Record logs its SQL queries through a [log subscriber] that listens for `sql.active_record` notifications. To make the integration seamless, I wanted Sequel's SQL queries to be logged via Active Record's logger.

Sequel logging is happening in `Database#log_connection_yield`, so we'll want to override that, and instrument the query execution with Active Support:

```rb
class Sequel::ActiveRecordConnection
  # ...
  def log_connection_yield(sql, conn, args = nil)
    sql += "; #{args.inspect}" if args # include bound variables in the output

    activerecord_log(sql) { super }
  end

  private

  def activerecord_log(sql)
    ActiveSupport::Notifications.instrument(
      "sql.active_record",
      sql:        sql,
      name:       "Sequel",
      connection: activerecord_connection,
      &block
    )
  end
  # ...
end
```
```rb
ActiveRecord::Base.logger = Logger.new($stdout)

DB[:records].where(foo: "bar").all
#>> Sequel (0.7ms) SELECT * "records" WHERE "foo" = 'bar'
```

## Wrapping it up

I committed the initial version into the rodauth-rails gem, but I soon realized that getting Sequel to reuse Active Record's database connection is not specific to Rodauth, so I extracted it into the [sequel-activerecord_connection] gem.

I'm glad I did, because it opened doors that weren't previously open. People can now try out Sequel alongside Active Record without any performance cost or mental overhead, which can be pretty handy given that [Sequel can do lots of things][previous] Active Record can't.

It [took][fix 1] [several][fix 2] [iterations][fix 3] to get the implementation right, but extracting it into its own gem helped me focus on this problem in isolation, and converge on the correct behaviour. The end result is a solution that covers much wider use cases than the original problem.

[rodauth-rails]: https://github.com/janko/rodauth-rails
[Sequel]: https://sequel.jeremyevans.net/
[lockstep]: https://github.com/janko/rodauth-rails/blob/2b54cba3018d95940fd34af0bc0b17a540b8d2ea/lib/rodauth/rails/active_record_extension.rb
[sequel-activerecord_connection]: https://github.com/janko/sequel-activerecord_connection
[database extension]: https://sequel.jeremyevans.net/rdoc/files/doc/extensions_rdoc.html#label-Database+Extensions
[log subscriber]: https://github.com/rails/rails/blob/main/activerecord/lib/active_record/log_subscriber.rb
[after_commit_everywhere]: https://github.com/Envek/after_commit_everywhere
[SQLite]: https://github.com/janko/sequel-activerecord_connection/blob/ee2039e2a1d297f70c0a7d7adab7aff47c52084b/lib/sequel/extensions/activerecord_connection/sqlite.rb
[MySQL]: https://github.com/janko/sequel-activerecord_connection/blob/ee2039e2a1d297f70c0a7d7adab7aff47c52084b/lib/sequel/extensions/activerecord_connection/mysql2.rb
[PostgreSQL]: https://github.com/janko/sequel-activerecord_connection/blob/ee2039e2a1d297f70c0a7d7adab7aff47c52084b/lib/sequel/extensions/activerecord_connection/postgres.rb
[previous]: /anything-i-want-with-sequel-and-postgres/
[fix 1]: https://github.com/janko/sequel-activerecord_connection/commit/0dc74427548e48eb0574b28ebefd65578b490f57
[fix 2]: https://github.com/janko/sequel-activerecord_connection/commit/a30953269cbe4bc764b055e33efb2a4acff977e2
[fix 3]: https://github.com/janko/sequel-activerecord_connection/commit/aadfb6e34d0a14bff2fa6e61b905e1e64621460d
