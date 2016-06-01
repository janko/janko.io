---
title: Ode to Sequel
tags: ruby orm postgresql activerecord
---

I've used and loved ActiveRecord for most of my Ruby life. While I was in
Rails, I couldn't imagine why I would want to use anything else. When I moved
away from Rails, I was still using ActiveRecord at first, but some things
started to bother me:

* limited query interface, you very quickly have to switch to SQL strings
* no good low-level query interface (Arel is not writable)
* very fuzzy LEFT JOIN support
* it's [pretty][sinar1] [difficult][sinar2] to set up ActiveRecord in a
  non-Rails project
* dependency on ActiveSupport and its core extensions (you may not want tons
  of monkey patches if you're using ActiveRecord outside of Rails)

I wanted to try another ORM. I've thought about [ROM], but I felt like it
required a completely different mindset. I wanted a gem which also implements
the [ActiveRecord pattern], but with a better implementation than the
ActiveRecord gem. I've heard about **[Sequel]** before, and I decided it was
finally high time to try it out.

Since then I've had a fair amount of experience with Sequel and its community,
and it's been amazing. Sequel has all the features I wanted from ActiveRecord,
and so much more, even features I didn't know I wanted. Jeremy Evans, the
author of Sequel, keeps Sequel at **0 issues**, and also keeps a mailing list
where you can get help with *anything*.

I would like to give you some of my personal highlights of Sequel's amazing
features.

*NOTE: "Sequel" should not be confused with "Squeel". Squeel is an extension for
ActiveRecord's query DSL, while Sequel is a complete ORM and an alternative to
ActiveRecord.*

## The plugin system

While ActiveRecord is one monolithic gem, Sequel utilizes a [plugin system].
Sequel consists of a relatively thin **core**, which gives you the most common
behaviour, and you can then choose to add additional functionality via
**plugins**. Each plugin corresponds to a single file included in the gem, but
which is required only when the plugin is loaded.

<div class="media">
  <img class="media-object pull-right" src="{{ site.baseurl }}/images/sequel-plugin_system.png" height="250" alt="Sequel's plugin system">
  <div class="media-body">
```ruby
require "sequel" # loads the core

DB = Sequel.connect("postgres:///my_database")

Sequel::Model.plugin :validation_helpers
Sequel::Model.plugin :json_serializer
Sequel::Model.plugin :nested_attributes
Sequel::Model.plugin :single_table_inheritance
```
  </div>
</div>

Because of this design [vanilla Sequel loads 5 times faster than
ActiveRecord][sequel-vs-activerecord].

## Query interface

Sequel's query interface is very similar to ActiveRecord's, but much more
advanced.

### Regular expressions

Did you know that PostgresSQL and MySQL have support for POSIX regular
expressions? Neither did I. If you're using one of these two databases, Sequel
will transform Ruby regular expressions to SQL:

```ruby
Movie.where(name: /future/)
# SELECT * FROM movies WHERE (name ~ 'future')
Movie.where(name: /future/i) # Case insensitive match
# SELECT * FROM movies WHERE (name ~* 'future')
```

This means that you can simply replace all your ugly LIKE queries with
beautiful regular expressions! Just note that regex matches are usually slower
than LIKE queries (in my benchmarks they were twice as slow), so be sure to
measure in your application how this impacts the performance. If it does, LIKE
queries are still nicer to write in Sequel (see below).

### Virtual row blocks

Most of Sequel's query methods, in addition to arguments, also support blocks
(so-called "virtual row blocks") which gives you a DSL for more advanced queries.

```ruby
Movie.where{year >= 2010}                        # inequality operators
# WHERE (year >= 2010)
Movie.where{(title =~ "Batman") | (year < 2010)} # OR query
# WHERE ((title = 'Batman') OR (year < 2010))
Movie.where{rating >= avg(rating)}               # functions get translated to SQL
# WHERE (rating >= avg(rating)
Movie.where{title.like("%Future%")}              # special methods
# WHERE (title LIKE '%FUTURE%')
```

You may be familiar with this syntax if you've ever used the [Squeel] gem. This
is because Squeel originally borrowed this syntax from Sequel (hence the play of
characters in the name). But the problem with Squeel is that it's essentially
an ActiveRecord hack, so it [breaks][squeel1] [with][squeel2] [every][squeel3]
ActiveRecord update. Virtual row blocks are a part of Sequel core, so they will
always remain fully stable.

While in ActiveRecord you often have to switch to SQL strings (OR query, LIKE
query, any non-canonic JOIN etc.), with Sequel's virtual row blocks you
essentially **never have to write SQL strings**.

### Low-level usage

When working with large amounts of data, the time it takes to allocate all these
ActiveRecord objects can very quickly surpass the time it takes for actual
queries to execute. This is often the case in ActiveRecod migrations, where
you're operating on whole production tables. Ideally you want to work instead
with light data structures, like hashes. However, as far as I know that's not
possible when querying through ActiveRecord models.

Some more advanced ActiveRecord users might be thinking that [Arel], a library
that ActiveRecord uses underneath to build SQL queries, is a good fit here.
Performance-wise it probably is, but Arel is very difficult to use and [the
resulting code is often very unreadable][arel code] (even with [arel-helpers]).

On the other hand, Sequel allows you to write low-level queries using the
**exact same** query interface you use for models! Instead of going through
models, You can go through the `Sequel::Database` object directly, and the
records will be returned as simple Ruby hashes.

```ruby
DB = Sequel.connect("postgres:///my_database") #=> #<Sequel::Database>

Movie.where(title: "Matrix").first       #=> #<Movie title="Matrix" year=1999 ...>
DB[:movies].where(title: "Matrix").first #=> {title: "Matrix", year: 1999, ...}

# DB[:movies].sql #=> "SELECT * FROM movies"
```

This means that with Sequel you can write very readable migrations (because you
don't have to [redefine your models inside migrations][redefining models]), and
have them be blazing-fast!

## Model design

Where ActiveRecord uses class-level DSL, Sequel instead prefers simple OO
design. For example, the idiomatic way to write validations in Sequel is by
overriding the instance method `#validate`:

```ruby
class Movie < Sequel::Model
  plugin :validation_helpers

  def validate
    validates_presence [:name, :year]
    validates_includes 1..10, :rating
    if genre == "Horror"
      validates_presence :rated
    end
  end
end
```

I personally find this way of writing validations much more natural than
ActiveRecord's class-level DSL, since I'm not constrained to `:if` and
`:unless` options. As a bonus, if validations become more complex, I can pull
them out of the model into a service object, and still be able to use the
convenient helper methods (since they're instance-level).

## JOINs

I'm not an SQL guru, but LEFT JOINs are really common in SQL. ActiveRecord
unfortunately doesn't directly support LEFT JOINs. The `#join` method only does
an INNER JOIN by default, and while you can use it to write a custom JOIN
statement, it's really verbose as you have to write the full SQL string with
all the column-joining logic.

```ruby
# LEFT JOINs in ActiveRecord
Movie.joins("LEFT JOIN on directors ON directors.movie_id = movies.id")
```

You could also use `includes(:directors).refrences(:directors)`, which does a
LEFT JOIN, but this also eager loads your directors into memory, which is
unfortunate if you don't need that.

Sequel, on the other hand, has support for *ALL* types of JOINs. You can do
joins through associations, or write them manually:

```ruby
Movie.association_left_join(:directors)     # association_(left|right|inner|cross|...)_join
Movie.left_join(:directors, movie_id: :id)  # (left|right|inner|cross|...)_join
```

## Postgres-specific support

Jeremy Evans really loves Postgres (as everyone should), and he put a lot of
effort into supporting as many Postgres features as possible in Sequel. And
Postgres has a *LOT* of features.

### JSON

Sequel supports reading and writing to JSON columns, but so does ActiveRecord,
so what's the big deal? What ActiveRecord doesn't have is an API for
*querying* JSON columns, which is the reason you're using JSON columns in the
first place. The problem is that Postgres' [JSON operators] can be quite
cryptic, which hurts your codebase. Luckily, Sequel provides a nice, readable
API to help you with that:

```ruby
Sequel.extension :pg_json_ops # we load the plugin ("ops" stands for "operations")

# Let's say that the `movies` table has an "info" JSON column.
info = Sequel.pg_json_op(:info) # we create a "JSON operation" object

Movie.where(info.has_key?('rated'))                  # WHERE (info ? 'rated')
Movie.where(info.get_text('rated') => 'PG-13')       # WHERE ((info ->> 'rated') = 'PG-13')
Movie.order(info.get_text(['directors', 1, 'name'])) # ORDER BY (info #>> ARRAY['directors', 1, 'name'])
```

### Views

Sequel makes it very simple and intuitive to write database views -- just use
the query interface!

```ruby
DB.create_view :recent_ruby_items, DB[:items].where(category: "ruby").limit(5)
# CREATE VIEW recent_ruby_items AS
# SELECT * from items WHERE category = 'ruby' LIMIT 5
```

Database views are very helpful for DRYing up some common queries, as you can
query them as tables (Thoughtbot used views to implement [multi-table full-text
search in Postgres][thoughtbot search]). Moreover, unlike other databases,
Postgres has [*materialized* views][materialized views], which transforms views
into sort of temporary tables by caching them, [which can really help you speed
up complex queries][materialized post]. Sequel supports materialized views by
accepting `materialized: true` in `DB.create_view`.

### Cursors

Sequel has a `#paged_each` method, which is an equivalent of ActiveRecord's
[`#find_each`][find_each]. This method is used to iterate over large datasets
without having to load all records into memory. By default these methods use a
separate query for each iteration, changing LIMIT and OFFSET to mimic paging.

Sequel, if it detects you're using Postgres, will instead change `#paged_each`
to use [Postgres cursors] under the hood, which are faster than additional
queries and work with unordered datasets.

```ruby
Movie.paged_each { |row| ... }
# BEGIN;
# DECLARE sequel_cursor NO SCROLL CURSOR WITHOUT HOLD FOR SELECT * FROM "table";
# FETCH FORWARD 1000 FROM sequel_cursor
# FETCH FORWARD 1000 FROM sequel_cursor
# ...
# FETCH FORWARD 1000 FROM sequel_cursor
# CLOSE sequel_cursor
# COMMIT
```

### sequel_pg

[sequel_pg] is a gem that provides a C extension which optimizes the fetching
of rows, generally resulting in a [2-6x speedup][sequel_pg performance]. So, you just add the gem to
your Gemfile and get free performance.

In addition to optimization, sequel_pg also adds [streaming support] if used on
PostgreSQL 9.2. Steaming support is similar to using a cursor, but it is faster
and more transparent. `#paged_each` will automatically use streaming to
implement paging if enabled.

### Other goodies

* Support for PostgresSQL's LISTEN/NOTIFY commands (e.g. [queue_classic] uses
  this feature):
* `DB.loose_count(:users)` for fast approximate counts using Postgres' system
  tables (COUNT queries can be slow on larger tables)
* "[pg_array_associations]" plugin which enables you to avoid an additional
  join table in "has and belongs to many" associations by keeping foreign keys
  in a Postgres array column instead
* and many more...

## Switching from ActiveRecord

Sequel has a very exhaustive guide "[Sequel for ActiveRecord Users]", which is
aimed at helping ActiveRecord users transition to Sequel. The guide first
explains how *each* ActiveRecord feature is implemented in Sequel, and mentions
some Sequel plugins you could use in your transition to make Sequel more
similar to ActiveRecord. Then it lists how *each and every* ActiveRecord's
method and option correspond to Sequel. Pretty good, huh?

There is a [sequel-rails] gem which is actively maintained, which helps you keep
the same development workflow as you had with Rails. It provides:

* Database Rake tasks (for migrations and such)
* Migration/model generators
* `Sequel::NoMatchingRow` error is returned as 404 (some other errors are
  mapped as well)
* Logging is integrated into Rails logs
* And more...

## Conclusion

Even after all of this, I have only scratched the surface of Sequel's amazing
features. ActiveRecord was long my ORM of choice only because it's part of
Rails, not because it was the best. After using Sequel for a period of time, I
have found it to be much more stable (0 issues maintained), better designed,
more performant ([benchmark]), and more advanced than ActiveRecord. It
enocurages you to make the most out of your database. I urge you to give it a
try!

[sinar1]: https://github.com/janko-m/sinatra-activerecord/blob/e7cf306a03c80e12a0632f3d156b911c6ec9d12f/lib/sinatra/activerecord/rake/activerecord_4.rb
[sinar2]: https://github.com/janko-m/sinatra-activerecord/blob/e7cf306a03c80e12a0632f3d156b911c6ec9d12f/lib/sinatra/activerecord/tasks.rake
[arel-helpers]: https://github.com/camertron/arel-helpers
[activerecord pattern]: http://www.martinfowler.com/eaaCatalog/activeRecord.html
[rom]: https://github.com/rom-rb/rom
[sequel]: http://sequel.jeremyevans.net/
[sequel logo]: /images/ruby-sequel.png
[sequel-vs-activerecord]: https://gist.github.com/janko-m/58e28d42fb268b0ac3c1#file-03-require-speed-rb
[squeel]: https://github.com/activerecord-hackery/squeel
[redefining models]: http://guides.rubyonrails.org/v3.2.8/migrations.html#using-models-in-your-migrations
[arel]: https://github.com/rails/arel
[arel code]: https://gist.github.com/janko-m/2b2cea3e8e21d9232fb9
[json operators]: http://www.postgresql.org/docs/9.4/static/functions-json.html#FUNCTIONS-JSON-OP-TABLE
[thoughtbot search]: https://robots.thoughtbot.com/implementing-multi-table-full-text-search-with-postgres
[materialized views]: http://www.postgresql.org/docs/9.4/static/rules-materializedviews.html
[materialized post]: http://webcache.googleusercontent.com/search?q=cache:8OnCH9RMeocJ:www.matchingnotes.com/caching-with-postgres-materialized-views.html+&cd=1&hl=en&ct=clnk&gl=us
[find_each]: http://api.rubyonrails.org/classes/ActiveRecord/Batches.html#method-i-find_each
[postgres cursors]: http://www.postgresql.org/docs/9.4/static/plpgsql-cursors.html
[sequel_pg]: https://github.com/jeremyevans/sequel_pg
[queue_classic]: https://github.com/QueueClassic/queue_classic
[streaming support]: https://github.com/jeremyevans/sequel_pg#streaming
[pg_array_associations]: http://sequel.jeremyevans.net/rdoc-plugins/classes/Sequel/Plugins/PgArrayAssociations.html
[plugin system]: http://sequel.jeremyevans.net/plugins.html
[sequel_pg performance]: https://github.com/jeremyevans/sequel_pg#real-world-difference
[squeel1]: https://github.com/activerecord-hackery/squeel/issues/196
[squeel2]: https://github.com/activerecord-hackery/squeel/issues/307
[squeel3]: https://github.com/activerecord-hackery/squeel/pull/354
[benchmark]: https://github.com/jeremyevans/simple_orm_benchmark
[sequel-rails]: https://github.com/TalentBox/sequel-rails
[sequel for activerecord users]: http://sequel.jeremyevans.net/rdoc/files/doc/active_record_rdoc.html
