---
title: ActiveRecord is reinventing Sequel
tags: ruby web rails framework orm activerecord sequel
---

For those who don't know, [Sequel] is an ORM very similar to ActiveRecord, in a
way that it also implements the [Active Record pattern]. As of this writing
it's 9 years old. I've already [written](http://twin.github.io/ode-to-sequel/)
about some of the main advantages of Sequel over ActiveRecord (and other people
have as well:
[1](http://rosenfeld.herokuapp.com/en/articles/ruby-rails/2013-12-18-sequel-is-awesome-and-much-better-than-activerecord),
[2](https://mrbrdo.wordpress.com/2013/10/15/why-you-should-stop-using-activerecord-and-start-using-sequel/)).

I'm using Sequel for over a year now, and am finding it to be consistently
better than ActiveRecord. But that's just my opinion, right? You can't really
say that one tool is objectively better than the other, each tool has its
tradeoffs.

Well, sometimes you simply can. What I've noticed is that, whenever a new shiny
ActiveRecord feature comes, Sequel has already had the same feature for quite
some time. That would be ok if these were a few isolated incidents, but
they're really not. ActiveRecord appears to have been consistently reinventing
Sequel.

Wait, that can't be right. ActiveRecord is insanely popular and it's part of
Rails, the Rails team surely wouldn't work so hard reimplementing something
that already exists. Anyway, that is a huge accusation, how can I possibly
prove my claims? Give me a chance, I really do have evidence. A *lot* of
evidence.

What I will do is walk you through ActiveRecord's most notable updates, and
look for Sequel's equivalents. I will also compare times when a feature landed
on both ORMs. I will list the features roughly in reverse chronological order
(from newest to oldest), so that we start from fresh memories.

## ActiveRecord 5

### Or

The `ActiveRecord::Relation#or` query method allows use of the OR operator
(previously you'd have to write SQL strings):

```ruby
Post.where(id: 1).or(Post.where(id: 2))
# => SELECT * FROM posts WHERE (id = 1) OR (id = 2)
```

Implementing this feature required a
[lot](https://github.com/rails/rails/pull/9052)
[of](https://github.com/rails/rails/pull/18706)
[discussion](https://github.com/rails/rails/pull/16052).
The feature finally landed in ActiveRecord ([commit](https://github.com/rails/rails/commit/9e42cf019f2417473e7dcbfcb885709fa2709f89)),
only **8 years** behind Sequel ([code](https://github.com/jeremyevans/sequel/blob/305b965a2790675bc920f8d2d1a3bc194e366af4/lib/sequel/dataset/sql.rb#L235)).

### Left joins

The `ActiveRecord::Relation#left_joins` query method generates a LEFT OUTER
JOIN (previously kind of possible via `#eager_load`):

```ruby
User.left_joins(:posts)
# => SELECT "users".* FROM "users" LEFT OUTER JOIN "posts" ON "posts"."user_id" = "users"."id"
```

The feature landed in ActiveRecord in 2015
([PR](https://github.com/rails/rails/pull/12071)). On the other hand, Sequel
has had support for all types of JOINs since **2008**, and added "association
joins" in **2014** ([commit](https://github.com/jeremyevans/sequel/commit/8dbec2f404703a0b265763c94af901f6053c22fa)).

### Attributes API

The [attributes API](http://edgeapi.rubyonrails.org/classes/ActiveRecord/Attributes/ClassMethods.html#method-i-attribute)
allows specifying/overriding types of columns/accessors in your models, as well
as querying with instances of those types, and bunch of other things. It took
Sean Griffin about 1 year to fully implement it.

It's difficult to point out at a specific equivalent in Sequel since the area
of ActiveRecord's attributes API is so broad. In my opinion you can roughly
achieve the same features with [serialization], [serialization_modification_detection],
[composition], [typecast_on_load], and [defaults_setter] plugins.

### Views

The `ActiveRecord::ConnectionAdapters::AbstractAdapter#views` method defined on
connection adapters returns an array of database view names:

```ruby
ActiveRecord::Base.connection.views #=> ["recent_posts", "popular_posts", ...]
```

Sequel implemented `#views` in 2011
([commit](https://github.com/jeremyevans/sequel/commit/ed27c3856fde5a5e03c4940db50fa93f4d9fd99a)),
**4 years** before ActiveRecord ([commit](https://github.com/rails/rails/commit/dcd39949f8801cb4beddec37143a585259f09a2d)).

### Indexing Concurrently

This PostgreSQL feature is crucial for zero-downtime migrations on larger
tables, ActiveRecord has had adding indices concurrently since 2013
([commit](https://github.com/rails/rails/commit/e199dc1a570d4f0d9a07628268835bce5aab2732)),
and dropping concurrently since 2015
([commit](https://github.com/rails/rails/commit/ce17e232a12861bce4bd950d7143df3fe0cd1991)).

Sequel supported both adding and dropping indices concurrently since **2012**
([commit](https://github.com/jeremyevans/sequel/commit/61593033c05f5f52617f0c72bdc63d92a020bfff)).

### In batches

`ActiveRecord::Relation#in_batches` yields batches of relations, suitable for
batched updates or deletes:

```ruby
Person.in_batches { |people| people.update_all(awesome: true) }
```

Sequel doesn't have an equivalent, because there is no one right way to do
batched updates, it depends on the situation. For example, the following Sequel
implementation in my benchmarks showed to be 2x faster than ActiveRecord's:

```ruby
(Person.max(:id) / 1000).times do |i|
  Person.where(id: (i*1000 + 1)..((i+1) * 1000)).update(awesome: true)
end
```

### Aborting hooks

Before Rails 5, returning `false` in any `before_*` callback resulted in
halting of callback chain. The new version
[removes](https://github.com/rails/rails/pull/17227) this behaviour and
requires you to be explicit about it:

```ruby
class Person < ActiveRecord::Base
  before_save do
    throw(:abort) if some_condition
  end
end
```

This is actually one of the rare cases where Sequel [added the equivalent
`cancel_action` method](https://github.com/jeremyevans/sequel/commit/2475df6223b92923dffe0bc4de4eb6bf21eda640)
being inspired by ActiveRecord's change :smiley:.

## ActiveRecord 4

### Adequate Record

[Adequate Record] is a set of performance improvements in ActiveRecord that
makes common `find` and `find_by` calls and some association queries up to 2x
faster. Aaron Patterson worked on Adequate Record for about 3 years.

However, running the [ORM benchmark] shows that Sequel is still much, much
faster than ActiveRecord, even after the Adequate Record merge.

### Postgres JSON, array and hstore

ActiveRecord 4 added support for Postgres JSON, array and hstore columns, along
with automatic typecasting. From looking at the commits we can say that
ActiveRecord received these features roughly at the same time as Sequel
([pg_json], [pg_array], [pg_hstore]), which is around the time these
features got added to Postgres. Note that Sequel on top of this also has an API
for *querying* these types of columns ([pg_json_ops], [pg_array_ops],
[pg_hstore_ops]), which greatly improves readability.

### Mutation detection

ActiveRecord 4.2+ automatically detects in-place changes to columns values, and
marks the record as dirty. Sequel added this feature through
[modification_detection](https://github.com/jeremyevans/sequel/commit/a9c4e060f436a9084d533c054395746cd8ae6bf1)
plugin after ActiveRecord. But note that in Sequel this is opt-in, so that
users can decide whether they want the performance hit.

### Where not

The `where.not` query construct allows negating a `where` clause, eliminating
the need to write SQL strings:

```ruby
Person.where.not(name: "John")
```

It was added in 2012 ([commit](https://github.com/rails/rails/commit/de75af7acc5c05c708443de40e78965925165217)),
in which time Sequel's equivalent `exclude` was existing already for **5 years**
([code](https://github.com/jeremyevans/sequel/blob/305b965a2790675bc920f8d2d1a3bc194e366af4/lib/sequel/dataset/sql.rb#L263)).

### Rewhere

In 2013 `ActiveRecord::Relation#rewhere` was
[added](https://github.com/rails/rails/commit/f950b2699f97749ef706c6939a84dfc85f0b05f2)
allowing you to overwrite all existing WHERE conditions with new ones:

```ruby
Person.where(name: "Mr. Anderson").rewhere(name: "Neo")
```

Sequel has had `unfiltered`, which removes existing WHERE and HAVING conditions,
since 2008, **5 years** before this ActiveRecord update
([commit](https://github.com/jeremyevans/sequel/commit/691a5c31a0f64d764a975c4bc563eb8de8b38507)).

### Enum

`ActiveRecord::Base#enum` was added to ActiveRecord 4.1
([commit](https://github.com/rails/rails/commit/db41eb8a6ea88b854bf5cd11070ea4245e1639c5)),
giving the ability to map names to integer columns:

```ruby
class Conversation < ActiveRecord::Base
  enum status: [:active, :archived]
end
```

While Sequel doesn't have this database-agnostic feature, it has the [pg_enum]
plugin for Postgres' enum type, although it was added only 1 year after
ActiveRecord's enum.

### Automatic inverse associations

ActiveRecord 4.1 added a feature to automatically detect inverse associations,
instead of having to always use `:inverse_of`
([commit](https://github.com/rails/rails/commit/ae6e6d953084d1966e52cc06ffe24131f0115cc1)).

Sequel had this basically since it added associations in 2008, which was about
**5 years** before ActiveRecord's update.

### Contextual validations

[Contextual validations](https://github.com/rails/rails/commit/50d971710150533562240bef660f14237b70d939)
allow passing a symbol when validating, and doing validations depending on the
existence or absence of the given symbol.

Sequel doesn't have this feature, since it's a code smell to have this in the
model, but Sequel's [instance-level validations] allow you to validate records
from service objects, which is a much better way of doing contextual
validation.

### Reversibility improvements

ActiveRecord 4.0 improved writing reversible migrations by allowing destructive
methods like `remove_column` to be reversible, as well as adding a really handy
`ActiveRecord::Migration#reversible` method allowing you to write everything in
a `change`, not having to switch to `up` and `down`.

Sequel's reversing capabilities are a bit lacking compared to ActiveRecord's,
they are currently about the same as ActiveRecord's before this change.

### Null relation

ActiveRecord 4.0 added a handy `ActiveRecord::Relation#none` which represents
an empty relation, effectively implementing a null object pattern for relations.

Sequel [added a null_dataset
plugin](https://github.com/jeremyevans/sequel/commit/e1e3207583c39ec69ea030e29b331868308c672c)
as an inspiration to ActiveRecord's feature.

## ActiveRecord 3

### EXPLAIN

In 2011 ActiveRecord 3.2 added `ActiveRecord::Relation#explain` for EXPLAIN-ing
queries
([commit](https://github.com/rails/rails/commit/e7b7b4412380e7ce2d8e6ae402cb7fe02d7666b8)).
Sequel has had EXPLAIN support for Postgres since 2007
([code](https://github.com/jeremyevans/sequel/blob/305b965a2790675bc920f8d2d1a3bc194e366af4/core/lib/sequel/adapters/postgres.rb#L365)),
and for MySQL was added only later in 2012
([commit](https://github.com/jeremyevans/sequel/commit/7708ec277572ddf36eee3999f20e67bedb07ac5b)).

### Pluck

ActiveRecord 3.2 added `ActiveRecord::Relation#pluck` in 2011
([commit](https://github.com/rails/rails/commit/a382d60f6abc94b6a965525872f858e48abc00de)),
and added support for multiple columns in 2012 ([commit](https://github.com/rails/rails/commit/2e379c1e63b3646f9aff4d7e242ca37b4a57f529)).

Sequel's equivalent `Sequel::Dataset#select_map` existed since 2009
([commit](https://github.com/jeremyevans/sequel/commit/ee3445294f5a83fdc02d5f03129eac839fdc74d2)),
and support for multiple columns was added in 2011 ([commit](https://github.com/jeremyevans/sequel/commit/3075880a2e0c4b42cc064cb5c342eb879bd809a1)).

### Uniq

ActiveRecord 3.2 added SELECT DISTINCT through `ActiveRecord::Relation#uniq` in
2011 ([commit](https://github.com/rails/rails/commit/562583c7667f508493ab8c5b1a4215087fafd22d)).
Sequel has had equivalent `Sequel::Dataset#distinct` since 2007
([code](https://github.com/jeremyevans/sequel/blob/a3c54c62a16b74218ba2311fb482b0b625972cd5/sequel_core/lib/sequel_core/dataset/sql.rb#L264)),
**4 years** ahead of ActiveRecord.

### Update column

ActiveRecord 3.1. added `ActiveRecord::Base#update_column` for updating
attributes without executing validations or callbacks
([commit](https://github.com/rails/rails/commit/245542ea2994961731be105db6c076256a22a7a9)).
The equivalent behaviour in Sequel, `user.this.update(...)`, at that moment
already existed for **4 years**.

### Reversible migrations

ActiveRecord 3.1 added support for reversible migrations via `change`
([commit](https://github.com/jeremyevans/sequel/commit/94450d775dfdc1b6cc0393944198bfa2ea0ecd71)).
Soon after that, and inspired by ActiveRecord, Sequel added its support for
reversible migrations ([commit](https://github.com/jeremyevans/sequel/commit/94450d775dfdc1b6cc0393944198bfa2ea0ecd71)).

### Arel

Finally, we come probably to ActiveRecord's biggest update: the chainable query
interface and extraction of [Arel]. For those who don't know, ActiveRecord
prior to 3.0 didn't have a chainable query interface.

Sequel already had this chainable query interface, before Nick Kallen started
working on Arel ([source](http://sequel.jeremyevans.net/2010/02/06/arel-sequel-differences-part-1.html)),
meaning he was obviously inspired by Sequel. Also, building queries with Arel
looks very different than through models (it's arguably more clunky), while
Sequel's low-level interface gives you the exact same API as you have through
models.

Alternative to Arel for building complex queries is [Squeel]. Beside the
obvious insipration indicated by the anagram in the name (even though there is
no mention of it in the README), the interface obviously mimics Sequel's
[virtual row blocks].

## Aftermath

In this detailed overview, even though Sequel was ahead of ActiveRecord in vast
majority of cases, there were a few cases where ActiveRecord was leading the
way:

* Reversible migrations
* Aborting hooks
* Mutation detection
* Enum (kind of)
* Null relation

We see that Sequel was closely keeping up with ActiveRecord, but ActiveRecord
wasn't keeping up with Sequel. Note that on GitHub Sequel maintains 0 open
issues, while ActiveRecord circles around 300 open issues. It's also worth
mentioning that Sequel is maintained mainly by one developer, while
ActiveRecord is developed by most of the Rails team.

## Conclusion

I want that you think about this. ActiveRecord was mainly implementing features
that Sequel already had. That could be justified if ActiveRecord had some other
advantages over Sequel, but I'm failing to see them. I don't classify
integration with Rails as an advantage (you can just make a [sequel-rails] for
that), I mean advantages that actually help interacting with databases.

I wished that I used Sequel from day one, instead of starting with ActiveRecord
and slowly realizing that Sequel is better. The only reason ActiveRecord is so
popular is because it's part of Rails, not because it's better. There is a
reason why [hanami-model] and [ROM] use Sequel under-the-hood and not
ActiveRecord. It hurts me that so many developer hours are put into
ActiveRecord, and I don't see for what purpose; a better tool already exists
and is excellently maintainted. Let's direct our energy towards the better
tool.

[Sequel]: http://github.com/jeremyevans/sequel
[Active Record pattern]: http://www.martinfowler.com/eaaCatalog/activeRecord.html
[Adequate Record]: https://tenderlovemaking.com/2014/02/19/adequaterecord-pro-like-activerecord.html
[ORM benchmark]: https://github.com/jeremyevans/simple_orm_benchmark
[serialization]: http://sequel.jeremyevans.net/rdoc-plugins/classes/Sequel/Plugins/Serialization.html
[serialization_modification_detection]: http://sequel.jeremyevans.net/rdoc-plugins/classes/Sequel/Plugins/SerializationModificationDetection.html
[composition]: http://sequel.jeremyevans.net/rdoc-plugins/classes/Sequel/Plugins/Composition.html
[typecast_on_load]: http://sequel.jeremyevans.net/rdoc-plugins/classes/Sequel/Plugins/TypecastOnLoad.html
[defaults_setter]: http://sequel.jeremyevans.net/rdoc-plugins/classes/Sequel/Plugins/DefaultsSetter.html
[pg_json]: http://sequel.jeremyevans.net/rdoc-plugins/files/lib/sequel/extensions/pg_json_rb.html
[pg_array]: http://sequel.jeremyevans.net/rdoc-plugins/files/lib/sequel/extensions/pg_array_rb.html
[pg_hstore]: http://sequel.jeremyevans.net/rdoc-plugins/files/lib/sequel/extensions/pg_hstore_rb.html
[pg_enum]: http://sequel.jeremyevans.net/rdoc-plugins/files/lib/sequel/extensions/pg_enum_rb.html
[pg_json_ops]: http://sequel.jeremyevans.net/rdoc-plugins/files/lib/sequel/extensions/pg_json_ops_rb.html
[pg_array_ops]: http://sequel.jeremyevans.net/rdoc-plugins/files/lib/sequel/extensions/pg_array_ops_rb.html
[pg_hstore_ops]: http://sequel.jeremyevans.net/rdoc-plugins/files/lib/sequel/extensions/pg_hstore_ops_rb.html
[tactical_eager_loading]: http://sequel.jeremyevans.net/rdoc-plugins/classes/Sequel/Plugins/TacticalEagerLoading.html
[instance-level validations]: http://sequel.jeremyevans.net/rdoc/files/doc/validations_rdoc.html#label-validation_helpers
[Arel]: https://github.com/rails/arel
[Squeel]: https://github.com/activerecord-hackery/squeel
[virtual row blocks]: http://sequel.jeremyevans.net/rdoc/files/doc/virtual_rows_rdoc.html
[sequel-rails]: https://github.com/TalentBox/sequel-rails
[hanami-model]: https://github.com/hanami/model
[ROM]: https://github.com/rom-rb/rom-sql
