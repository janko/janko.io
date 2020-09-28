---
title: "The Complexity of Active Record Transactions"
---

I've recently picked up the [sequel-activerecord_connection] gem again to make
some reliability improvements around database transactions. For context, this
gem extends [Sequel] with the ability to reuse Active Record's database
connection, which should lower the barrier for trying out Sequel in apps that
use Active Record.

After [pushing some fixes][pondering commit], I was thinking how working on
this gem has greatly increased my familiarity with the internals of database
transaction implementations of both Active Record and Sequel. Since there
aren't any existing articles on this topic, I thought it would be useful to
share the knowledge I gathered over the past few months.

This article will compare the transaction API implementation between Active
Record and Sequel, and assumes the reader is already familiar with Active
Record's transaction API usage. As the title suggests, I will be critical of
Active Record's implementation. I know some will perceive this as "not nice",
but I think it's important to be aware of the internal complexity of libraries
we're using every day (myself included).

## Model vs Database

### Active Record

Active Record transactions are typically called on the model, which is shown in
the [official docs][activerecord transaction docs] as well. I think this can be
misleading to novice developers, as it suggests that database transactions are
tied to specific database tables, when in fact they're applied to any queries
made by the current database connection.

```rb
# opens a connection-wide transaction (unrelated to the `accounts` table)
Account.transaction do
  balance.save!
  account.save!
end
```

Active Record provides transaction callbacks as part of a model's lifecycle,
allowing you to execute code after the transaction commits or rolls back. This,
for example, allows you to spawn a background job after a record is created,
where waiting until the transaction commits will ensure the record is available
when the background job is picked up.

```rb
class Account < ActiveRecord::Base
  after_create_commit :send_welcome_email

  private

  def send_welcome_email
    AccountMailer.welcome(self).deliver_later
  end
end
```

In my opinion, this approach has several issues. For one, it encourages putting
business logic into your Active Record models, and generally increases
complexity of the model lifecycle. It's not trivial to use transaction
callbacks *outside* of models, because Active Record transactions are [coupled
to models][activerecord model coupling] (although there are
[gems][after_commit_everywhere] that work around that).

Transaction callbacks can also negatively impact memory usage if you're
allocating many model instances within a transaction, as references to these
model instances are held until the transaction is committed or rolled back,
which prevents Ruby's GC to collect them beforehand. And you're paying this
performance penalty regardles of whether you're using any transaction
callbacks, as [each model instance is added to the transaction][activerecord
add model].

```rb
ActiveRecord::Base.transaction do
  author.comments.find_each do |comment|
    # Ruby cannot garbage collect these model instances until the transaction
    # is committed or rolled back.
    comment.update(author: new_author)
  end
end
```

### Sequel

In Sequel, the transaction API is implemented on the database object, which is
completely decoupled from models.

```rb
DB = Sequel.connect(adapter: "postgresql", database: "myapp") #=> #<Sequel::Database ...>
```
```rb
# calling #transaction on the database object communicates it's connection-wide
DB.transaction do
  balance.save
  account.save
end
```

Sequel also has transaction hooks, but they too are defined on the database
object, and aren't tied to models in any way – they're just blocks of code that
get executed after the transaction is committed or rolled back. This makes them
possible to use in business logic that lives outside of models (of course, in
that case one can also just move the code outside of the transaction block).

```rb
class CreateAccount
  def call(attributes)
    DB.transaction do
      account = Account.create(attributes)
      send_welcome_email(account)
      account.update(api_key: SecureRandom.hex)
    end
  end

  private

  def send_welcome_email(account)
    # queue email delivery after the enclosing transaction commits
    DB.after_commit do
      AccountMailer.welcome(account).deliver_later
    end
  end
end
```

And if you really want to register transaction hooks on the model level, you
can do that inside regular model lifecycle hooks:

```rb
class Comment < Sequel::Model
  def after_update
    if column_changed?(:body)
      db.after_commit { MentionNotificationJob.deliver_later(self) }
    end
  end
end
```

By giving us the ability to compose APIs this way, the `Sequel::Model` class
was able to remain unaware of the existence of transaction hooks (which keeps
it simpler), but we were still able to achieve the same functionality as we
have with Active Record.

In the above example we've intentionally put the conditional *outside* of the
`#after_commit` block, as that allows the model instance to be garbage
collected in long-running transactions when the condition evaluates to false
(useful in use cases like [file attachments][shrine sequel optimization]).

```rb
DB.transaction do
  author.comments_dataset.paged_each do |comment|
    # Ruby *can* garbage collect these model instances while the loop is executing.
    comment.update(author: new_author)
  end
end
```

## Transaction state

### Active Record

Active Record maintains transaction state on the [connection
level][activerecord transaction manager], but a lot of transaction-related
state is also maintained at the [model level][activerecord model transactions].
While the transaction manager is implemented pretty decently, the
`ActiveRecord::Transactions` module is incredibly complex, and
[has](https://github.com/rails/rails/issues/29747)
[been](https://github.com/rails/rails/issues/36934)
[the](https://github.com/rails/rails/issues/37152)
[source](https://github.com/rails/rails/issues/39972)
[of](https://github.com/rails/rails/issues/39400)
[numerous](https://github.com/rails/rails/issues/14493)
[issues](https://github.com/rails/rails/issues/36132).

The reason for this complexity is that every new incoming bug has generally
been solved by adding yet another tweak, yet another conditional, yet another
instance variable. And some of these instance variables even leak outside of
the `ActiveRecord::Transactions` module, which indicates a leaky abstraction.

Honestly, for me this reached a state where I don't consider Active Record's
transaction callbacks to be safe enough for production, and I try to avoid them
whenever possible.

### Sequel

Sequel stores all the transaction state in a single `@transactions` instance
variable on the database object. Models don't have access to the transaction
state, which keeps transactions fully decoupled from models.

```rb
DB.transaction do |conn|
  DB.after_commit { ... }
  DB.transaction(savepoint: true) do
    DB.instance_variable_get(:@transactions)[conn] #=>
    # {
    #   after_commit: [
    #     <Proc...> # the block we've registered above
    #   ],
    #   savepoints: [
    #     { ... }, # transaction data
    #     { ... }  # savepoint data
    #   ]
    # }
  end
end
```

If you're reading [Sequel's transaction code][sequel transactions], you'll
notice that all of it is contained in a single file and single context
(including transaction hooks). In my experience this made the logic much easier
to grok.

## Lazy transactions

### Active Record

In version 6.0, Active Record [introduced][activerecord lazy transactions] a
performance optimization that makes transactions lazy. What this means is that
Active Record will issue BEGIN/COMMIT queries only if there was at least one
query exected inside the transaction block.

```rb
ActiveRecord::Base.transaction do
  ActiveRecord::Base.connection.execute "SELECT 1"
end
# BEGIN
# SELECT 1
# COMMIT

ActiveRecord::Base.transaction do
end
# (no queries were executed)
```

The main use case behind this addition seems to be saving lots of records whose
attributes didn't change, where each attempted update would execute empty
BEGIN/COMMIT statements (even though no UPDATE was issued), which didn't
perform well. A workaround at the time would be to call `record.save if
record.changed?` instead.

```rb
article = Article.find(id)
article.published #=> true
article.update(published: true) # executed empty BEGIN/COMMIT prior to Active Record 6.0
```

However, as [Sean Griffin had pointed out][sean griffin complexity] in the pull
request review, this added significant complexity for very little gain. In
addition to requiring [additional transaction state][activerecord materialized
state], each Active Record adapter is now also responsible for [materializing
transactions when necessary][activerecord adapter materializing].

### Sequel

In Sequel, opening a transaction will always execute BEGIN/COMMIT statements
(if the transaction commits), regardless of whether any queries were made
inside the block or not.

```rb
DB.transaction do
end
# BEGIN
# COMMIT
```

`Sequel::Model#save` behaves differently than `ActiveRecord::Base#save`, in
terms that it always executes an UPDATE statement for an existing record
(updating all columns). To update only changed attributes, you would use
`Sequel::Model#save_changes`, which doesn't execute UPDATE if no attributes
have changed. And `Sequel::Model#update` calls `#save_changes` under the hood:

```rb
article = Article.find(id)
article.published #=> true
article.update(published: true) # no queries executed
```

Unlike `ActiveRecord::Base#save`, `Sequel::Model#save_changes` doesn't open a
transaction if it won't execute the UPDATE statement. This is a much more
elegant solution to the problem Active Record's lazy transactions intended to
solve, but with none of the complexity.

## Final words

I really care that libraries I'm using at work have sufficiently
straightforward internals that I can understand when debugging an issue. When
it comes to database transactions, Active Record's internal complexity is just
too overwhelming for me (and that's coming from someone who contributes to open
source on a daily basis).

On the other hand, the Sequel's transaction implementation was fairly
straightforward to understand, which is all the more impressive considering
that it's more feature-rich compared to Active Record (see the [docs][sequel
transactions docs]). And this is not an exception – I regularly see this
pattern whenever I'm reading Sequel's source code :wink:

Hopefully this article will add another point towards Sequel for people
starting new Ruby/Rails projects.

[sequel-activerecord_connection]: https://github.com/janko/sequel-activerecord_connection
[Sequel]: https://github.com/jeremyevans/sequel
[pondering commit]: https://github.com/janko/sequel-activerecord_connection/commit/a30953269cbe4bc764b055e33efb2a4acff977e2
[activerecord transaction docs]: https://api.rubyonrails.org/classes/ActiveRecord/Transactions/ClassMethods.html
[activerecord model coupling]: https://github.com/rails/rails/blob/f40c17dcfafa57bcbd8fd2ff6745f37334ba78d9/activerecord/lib/active_record/connection_adapters/abstract/transaction.rb#L137-L154
[after_commit_everywhere]: https://github.com/Envek/after_commit_everywhere
[activerecord add model]: https://github.com/rails/rails/blob/f40c17dcfafa57bcbd8fd2ff6745f37334ba78d9/activerecord/lib/active_record/transactions.rb#L349
[shrine sequel optimization]: https://github.com/shrinerb/shrine/commit/08ed806110139b83401f603ac95cea5d6abf7bd2
[activerecord transaction manager]: https://github.com/rails/rails/blob/f40c17dcfafa57bcbd8fd2ff6745f37334ba78d9/activerecord/lib/active_record/connection_adapters/abstract/transaction.rb
[activerecord model transactions]: https://github.com/rails/rails/blob/f40c17dcfafa57bcbd8fd2ff6745f37334ba78d9/activerecord/lib/active_record/transactions.rb
[sequel transactions]: https://github.com/jeremyevans/sequel/blob/1bcb1996fc7be80db8001640aae6fb5a2ca5ff19/lib/sequel/database/transactions.rb
[activerecord lazy transactions]: https://github.com/rails/rails/commit/0ac81ee6ff3d1625fdbcc40b12c00cbff2208077
[sean griffin complexity]: https://github.com/rails/rails/pull/32647#pullrequestreview-114218234
[activerecord materialized state]: https://github.com/rails/rails/blob/3803671a816232395f538c61046b00c875c1444b/activerecord/lib/active_record/connection_adapters/abstract/transaction.rb#L219-L221
[activerecord adapter materializing]: https://github.com/rails/rails/blob/3803671a816232395f538c61046b00c875c1444b/activerecord/lib/active_record/connection_adapters/postgresql_adapter.rb#L689
[sequel transactions docs]: http://sequel.jeremyevans.net/rdoc/files/doc/transactions_rdoc.html
