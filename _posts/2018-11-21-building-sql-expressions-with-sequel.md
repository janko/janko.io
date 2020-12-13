---
title: Building SQL Expressions with Sequel
tags: sequel
canonical_url: https://bits.theorem.co/building-sql-expressions-with-sequel/
comments: disqus
---

I’ve recently started working on a new project which uses [Sequel], and it reminded me how much I love it. For those who don’t know, Sequel is a superb alternative to Active Record. I wrote a [gentle introduction to Sequel][ode to sequel] a while back.

One of the prettiest parts of Sequel for me is the API for building SQL expressions, so in this article I would like to talk more about that. But before we start with Sequel, I first want to talk a little bit about Active Record.

## Active Record

In Active Record, equality and inclusion expressions are typically built with simple ruby hashes:

```rb
Movie.where(rating: 7, genre: ["Adventure", "Comedy"])
# WHERE movies.rating = 7 AND movies.genre IN ('Adventure', 'Comedy')
```

Negation is also easy with `where.not(...)`:

```rb
Movie.where.not(rating: 7, genre: ["Adventure", "Comedy"])
# WHERE movies.rating != 7 AND movies.genre NOT IN ('Adventure', 'Comedy')
```

A nested hash can be used to qualify columns with a different table name (useful for joined datasets):

```rb
Movie.joins(:rating).where(rating: { imdb: 7, netflix: 5..8 })
# WHERE rating.imdb = 7 AND rating.netflix >= 5 AND rating.netflix <= 8
```

However, as soon as we need something that cannot be expressed by a hash, it’s common to just reach for raw SQL strings:

```rb
Movie.where("year >= ? OR name LIKE ?", 2012, "Summer%")
# or
Movie.where("year >= :year OR name LIKE :term", year: 2012, term: "Summer%")
```

Personally, I find this less readable than the hash version, because we need to use placeholders for values that need to be escaped, and provide actual values after the SQL string. Using raw SQL strings is also not very consistent, because now you have some expressions built in Ruby and other are provided in raw SQL.

To address these disadvantages, many people have discovered [Arel], Active Record’s internal query builder. It has an expression builder API that allows us to avoid SQL strings for many types of expressions.

```rb
Movie.where(Movie.arel_table[:rating].gteq(7))
# SELECT movies.* FROM movies WHERE movies.rating >= 7
```

We can chain method calls to create more complex expressions, and add the [arel-helpers] gem that aliases `#arel_table` to `#[]`:

```rb
Movie.where(Movie[:rating].gteq(7).or(Movie[:director].eq("Quentin Tarantino")))
# SELECT movies.* FROM movies WHERE movies.rating >= 7 OR movies.director = 'Quentin Tarantino'
```

However, whether this approach is better than using raw SQL strings is up for debate. On one hand, Arel allows you to inline the values that need to be escaped, so you don’t have to use the `?` placeholders. It’s also database agnostic, since you’re building an abstract syntax tree that will be converted to the database-specific SQL by the underlying Active Record adapter.

On the other hand, Arel expressions can get difficult to read as they typically have much more parentheses than their raw SQL counterparts. Also, Arel is considered private API, so it’s not optimized for convenience and it’s subject to change. That’s probably the reason why I also found it very scarcely documented (you won’t find `ActiveRecord::Base.arel_table` in the API documentation).

## Sequel

Sequel’s SQL expression builder API is similar to Arel in the sense that it also builds an abstract syntax tree. However, in Sequel this is public API, it’s optimized for convenience, it’s stable, and it’s very well documented.

We will now walk through various SQL expression types, starting from the most common ones, and show how Sequel always has us covered.

### Operators

We’ve already seen that Arel uses methods for building expressions with SQL operators, which can create a lot of nested parentheses. Sequel, on the other hand, uses actual Ruby operators, which make the expressions naturally readable.

#### Equality operators

Sequel can use simple Ruby hashes to do equality and inclusion, just like Active Record:

```rb
Movie.where(
  director:     "Quentin Tarantino",    # string equality
  genre:        ["Adventure", "Drama"], # set inclusion
  released:     true,                   # TRUE/FALSE equality
  premiered_at: nil,                    # NULL equality
)
```

But what if you want to join conditions with `OR` instead of `AND`? Or you want to use inequality (`>`, `>=`, `<=`, `<`) or numeric (`+`, `-`, `*`, `/`) operators? Or `LIKE` conditions? Sure, you can always switch to raw SQL strings, but with Sequel we can do better.

Sequel gives you the option to break away from hashes by providing an API for building expressions. One of the simplest expression objects is a column identifier:

```rb
Sequel[:director]
# Sequel::SQL::Identifier: director
```

The basic operators defined on expression objects are `=~` (meaning “equals”) and `!~` (meaning “not equals”). The result of an operator is again an expression object.

```rb
Sequel[:director] =~ "Quentin Tarantino"
# Sequel::SQL::BooleanExpression: director = 'Quentin Tarantino'

Sequel[:genre] !~ "Drama"
# Sequel::SQL::BooleanExpression: genre != 'Drama'
```

We can go back and rewrite our hash example using Sequel expressions:

```rb
Movie.where(
  (Sequel[:director]     =~ "Quentin Tarantino")    &
  (Sequel[:genre]        =~ ["Adventure", "Drama"]) &
  (Sequel[:released]     =~ true)                   &
  (Sequel[:premiered_at] =~ nil)
)
```

This is of course longer and more verbose than the hash version, it’s just to introduce the API, so bear with me.

Now, having to repeat `Sequel[]` whenever we want to create an identifier object can be cumbersome, so Sequel offers the virtual row block syntax that automatically creates identifier objects via `method_missing`. All you have to do is pass a block to `.where` and then you can omit the `Sequel[]`:

```rb
Movie.where{
  (director     =~ "Quentin Tarantino")    &
  (genre        =~ ["Adventure", "Drama"]) &
  (released     =~ true)                   &
  (premiered_at =~ nil)
}
```

Active Record users might recognize this syntax if they have ever used the Squeel Active Record extension. [Squeel] was heavily inspired by Sequel’s virtual row blocks.

#### Boolean operators

You may have noticed the `&` operators between the conditions above. As you might have guessed, Sequel will translate those into `AND` in SQL.

```rb
(Sequel[:director] =~ "Quentin Tarantino") & (Sequel[:genre] !~ "Drama")
# SQL: (director = 'Quentin Tarantino') AND (genre != 'Drama')
```

Up until now there was no benefit of using the expression API over hashes, because we’ve only dealt with equality conditions joined with `AND`. If we wanted to use an `OR` condition instead, in Active Record we would have to switch to raw SQL. But with Sequel we can just use the `|` operator:

```rb
(Sequel[:director] =~ "Quentin Tarantino") | (Sequel[:genre] !~ "Drama")
# SQL: (director = 'Quentin Tarantino') OR (genre != 'Drama')
```

Note that we have to put parentheses around the clauses, because `&` and `|` operators have higher predence than `=~` and `!~`.

You might be wondering why we can’t just use `&&` and `||` instead of `&` and `|`. The reason is that `&&` and `||` are keywords built into the Ruby interpreter, therefore it’s not possible to change their meaning. `&` and `|`, on the other hand, are just methods which can be overriden like many other operators.

```rb
def &(other)
  # ...
end

def |(other)
  # ...
end
```

The third boolean operator is negation (`NOT`). With Sequel we can negate expressions using the `~` unary operator:

```rb
~((Sequel[:director] =~ "Quentin Tarantino") | (Sequel[:genre] !~ "Drama"))
# SQL: (director != 'Quentin Tarantino') AND (genre = 'Drama')
```

If you prefer and are able to use plain hashes, you can still use the `&`, `|`, and `~` operators defined on the Sequel module:

```rb
Movie.where(Sequel.|(
  Sequel.&(genre: "Comedy", released: true),
  Sequel.~(genre: "Horror"),
))
# SELECT * FROM movies WHERE ((genre = 'Comedy') AND (released IS TRUE)) 
```

#### Inequality operators

In addition to the equality operators (`=` and `!=`), Sequel also defines inequality operators (`>`, `>=`, `<=`, `<`) on the expression objects.

```rb
Sequel[:rating] >= 7 # SQL: rating >= 7
```

We can then chain them with boolean operators in the same way:

```rb
Movie.where((Sequel[:imdb_rating] > 7.5) & (Sequel[:rotten_tomatoes_rating] >= 6))
# SELECT * FROM movies WHERE imdb_rating > 7.5 AND rotten_tomatoes_rating >= 6
```

And use virtual row blocks:

```rb
Movie.where{(imdb_rating > 7.5) & (rotten_tomatoes_rating >= 6)}
# SELECT * FROM movies WHERE imdb_rating > 7.5 AND rotten_tomatoes_rating >= 6
```

#### Numeric and String operators

The expression objects also define some numeric operators we’d expect:

```rb
Sequel[:order] + 2 # SQL: order + 2
Sequel[:order] - 2 # SQL: order - 2
Sequel[:order] * 2 # SQL: order * 2
Sequel[:order] / 2 # SQL: order / 2
```

On string expressions `+` is defined as concatenation:

```rb
Sequel[:first_name] + " " + Sequel[:last_name]
# SQL: first_name || ' ' || last_name
```

### Qualifying

Sequel doesn’t automatically qualify column identifiers, because SQL doesn’t either.

```rb
Movie.where(name: "Matrix")
# ActiveRecord: SELECT movies.* FROM movies WHERE movies.name = 'Matrix'
# Sequel:       SELECT * FROM movies WHERE name = 'Matrix'
```

To qualify a column identifier with a table name, you can call another square brackets on the identifier:

```rb
Movie.where(Sequel[:movies][:name] => "Matrix")
Movie.where{movies[:name] =~ "Matrix"}
# SELECT * FROM movies WHERE movies.name = 'Matrix'
```

You can also qualify whole expressions with `Sequel.deep_qualify`:

```rb
Sequel.deep_qualify(:movies,
  (Sequel[:imdb_rating] + Sequel[:rotten_tomatoes_rating] >= 10) &
  (Sequel[:released_at].extract(:year) >= 2000)
)
# SQL: (movies.imdb_rating + movies.rotten_tomatoes_rating >= 10) AND
#      (extract(year FROM movies.released_at) >= 2000)
```

To just qualify all column identifiers in a dataset, use `Sequel::Dataset#qualify`:

```rb
Movie.select(:name).where(genre: "Adventure").order(:rating)
# SELECT name FROM movies WHERE (genre = 'Adventure') ORDER BY rating
Movie.select(:name).where(genre: "Adventure").order(:rating).qualify
# SELECT movies.name FROM movies WHERE (movies.genre = 'Adventure') ORDER BY movies.rating
```

Active Record does have the more convenient hash syntax for qualifying `#where` conditions. However, I don’t find it ideal to have to nest conditions that have the same level of importance.

```rb
# ActiveRecord
Movie.joins(:rating)
  .where(
    released: true,     # movies.released IS TRUE
    rating: { imdb: 7 } # rating.imdb = 7
  )

# Sequel
Movie.association_join(:rating)
  .where{
    (released     =~ true) & # movies.released IS TRUE
    (rating[imdb] =~ 7)      # rating.imdb = 7
  }
```

### Ordering

Ordered expressions can be created with `Sequel.asc` and `Sequel.desc`:

```rb
Sequel.desc(:rating)
# Sequel::SQL::OrderedExpression: rating DESC
Sequel.asc(:rating)
# Sequel::SQL::OrderedExpression: rating ASC
```

These can then be passed to `#order`:

```rb
Movie.order(Sequel.desc(:rating))
Movie.order(Sequel[:rating].desc)
Movie.order{rating.desc}
# SELECT * FROM movies ORDER rating DESC
```

When I first came to Sequel after having used Active Record for many years, I was wondering if there was something like `order(rating: :desc)` in Sequel. Jeremy explained that this syntax would violate the general rule in Sequel that hashes are used for equality expressions. I also came to realize how flexible is that `#asc` and `#desc` are methods.

For example, that allows Sequel to support `NULLS FIRST` and `NULLS LAST` via the `:nulls` option:

```rb
Movie.order{rating.desc(nulls: :last)}
# SELECT * FROM movies ORDER BY rating DESC NULLS LAST
```

You can also order by any complex expressions:

```rb
Movie.order{(imdb_rating + rotten_tomatoes_rating).desc}
# SELECT * FROM movies ORDER BY (imdb_rating + rotten_tomatoes_rating) DESC
```

Since ordered expressions are expressions, Sequel will recognize them anywhere, even for example in parameters for a window function:

```rb
Movie.select{row_number.function.over(partition: :director, order: released_at.asc)}
# SELECT row_number() OVER (PARTITION BY director ORDER BY released_at ASC) FROM movies
```

### LIKE

Sequel supports `LIKE` and `ILIKE` expressions via `#like` and `#ilike` methods:

```rb
Sequel.like(:title, "Summer%")
# Sequel::SQL::BooleanExpression: title LIKE 'Summer%'
Sequel.ilike(:title, "summer%")
# Sequel::SQL::BooleanExpression: title ILIKE 'Summer%'
```

They can then be used in `#where`:

```rb
Movie.where(Sequel.like(:title, "Summer%"))
Movie.where(Sequel[:title].like("Summer%"))
Movie.where{title.like("Summer%")}
# SELECT * FROM movies WHERE title LIKE 'Summer%'
```

Here is an example of creating filter expression that matches a search term onto multiple columns:

```rb
filter = [:title, :summary, :director]
  .map { |column| Sequel.ilike(column, "%#{search_term}%") }
  .inject(:&)

Movie.where(filter)
# SELECT * FROM movies WHERE title ILIKE '%foo%' AND summary ILIKE '%foo%' AND director ILIKE '%foo%'
```

### Functions

Some SQL functions have their dedicated API in Sequel, but in general Sequel supports calling any SQL function. `Sequel.function` can be used to create a function expression; the first argument is the function name and the rest are function arguments.

```rb
Sequel.function(:max, :rating) # SQL: max(rating)
```

They can then be used in places like `#select`:

```rb
Movie.select(Sequel.function(:max, :rating))
# SELECT max(rating) FROM movies
```

To create `count(*)`, you can use the `*` unary operator:

```rb
Movie.select(Sequel.function(:count).*)
# SELECT count(*) FROM movies
```

Sequel’s virtual row blocks make calling SQL functions more convenient via `method_missing`. An undefined method called with arguments will automatically be converted into a function, whereas to create a function without arguments you’ll need to add a call to `#function`.

```rb
Movie.select{max(rating)}         # SELECT max(rating)  FROM movies
Movie.select{row_number.function} # SELECT row_number() FROM movies
Movie.select{count.function.*}    # SELECT count(*)     FROM movies
```

This means you can easily convert even complex SQL queries into Sequel:

```sql
SELECT coalesce(first_name, '') || ' ' || coalesce(last_name, '') AS full_name
FROM users
WHERE now() - created_at <= 24*60*60
ORDER BY lower(full_name)
```
```rb
User
  .select{(coalesce(:first_name, '') + ' ' + coalesce(:last_name, '')).as(:full_name)}
  .where{(now.function - :created_at) <= 24*60*60}
  .order{lower(:full_name)}
```

In Arel you have the `Arel::Nodes::NamedFunction` counterpart, but using it is much more verbose:

```rb
# ActiveRecord
User.select(Arel::Nodes::NamedFunction.new("coalesce", [User.arel_table[:first_name], Arel.sql("''")]))
# SELECT coalesce(users.first_name, '') FROM users
```

### Aliasing

Sequel provides support for aliasing via the `#as` method. You can alias anything from column identifiers:

```rb
Movie.select(Sequel.as(:imdb_rating, :rating))
# SELECT imdb_rating AS rating FROM movies
```

to expressions:

```rb
User.select(Sequel.join([:first_name, :last_name], ' ').as(:full_name))
# SELECT (first_name || ' ' || last_name) AS full_name FROM users
```

and even whole datasets:

```rb
User.join(UserActivityLog.order{created_at.desc}.limit(100).as(:logs), user_id: :id)
# SELECT * FROM users JOIN (
#   SELECT * FROM user_activity_logs ORDER BY created_at DESC LIMIT 100
# ) AS logs ON (logs.user_id = users.id)
```

Arel also has `#as` for aliasing, but for some reason it’s not available for all types of expressions:

```rb
# ActiveRecord
Movie.arel_table[:rating].as("total_rating")
# SQL: rating AS total_rating
(Movie.arel_table[:imdb_rating] + Movie.arel_table[:netflix_rating]).as("total_rating")
# ~> NoMethodError: undefined method `as' for #<Arel::Nodes::Grouping:0x00007fb915477e28>
```

### CASE

You can build `CASE` statements with `Sequel.case`, where first argument is the hash of `WHERE`/`THEN` conditions, second argument is the `ELSE` default value, and the third optional argument is the `CASE` expression.

```rb
Sequel.case(                          # CASE
  {
    (Sequel[:rating] >= 8) => "good", # WHEN rating >= 8 THEN 'good'
    (Sequel[:rating] >= 6) => "ok",   # WHEN rating >= 6 THEN 'ok'
    (Sequel[:rating] >= 4) => "bad",  # WHEN rating >= 4 THEN 'bad'
  },
  "abysmal"                           # ELSE 'abysmal'
)
```

A few years ago I made a pull request to RubyGems.org, which added a Rake task that syncs cached download counts from Redis into the Postgres database. Since the `rubygems` table has many rows, I didn’t want to execute an `UPDATE` query for each row, so I built a `CASE` statement in SQL:

```rb
case_query = Rubygem.pluck(:name)
  .map { |name| "WHEN '#{name}' THEN #{$redis["downloads:rubygem:#{name}"].to_i}" }
  .join("\n            ")

ActiveRecord::Base.connection.execute <<-SQL.strip_heredoc
  UPDATE rubygems
    SET downloads = CASE name
      #{case_query}
    END
SQL
```

With Sequel this whole expression can be created in Ruby:

```rb
counts_by_name = Rubygem.select_map(:name)
  .map { |name| [name, $redis["downloads:rubygem:#{name}"].to_i] }

Rubygem.update(downloads: Sequel.case(counts_by_name, :downloads, :name))
```

Arel also has its own `Arel::Nodes::Case`, which is built incrementally. However, Active Record’s `#update_all` method doesn’t seem to accept Arel expressions, because this case expression gets converted to `NULL`.

```rb
download_counts = Arel::Nodes::Case.new(Rubygem.arel_table[:name])

Rubygem.pluck(:name)
  .map  { |name| [name, $redis["downloads:rubygem:#{name}"].to_i] }
  .each { |name, count| download_counts.when(name).then(count) }

download_counts.else(Rubygem.arel_table[:downloads])

Rubygem.update_all(downloads: download_counts)
# UPDATE "rubygems" SET "downloads" = NULL
```

### Array & JSON operations

The last type of expressions we’ll cover are operations with Postgres Array and JSON types. These operations include operators and function names that can be difficult to remember, and Sequel provides a convenience API via the [pg_array_ops] and [pg_json_ops] extensions (see [this document][extensions] for more on Sequel extensions).

```rb
DB.extension :pg_array, :pg_json             # load support for array and json types
Sequel.extension :pg_array_ops, :pg_json_ops # load methods for building array/json expressions
```

We first need to create an array/json expression by calling `#pg_array` and `#pg_jsonb`, and then we can call operation methods on that object.

```rb
Movie.where{
  genres.pg_array.contains(["Adventure", "Comedy"]) &
  (imdb.pg_jsonb['Rating'] >= 7)
}
# SELECT * FROM movies WHERE (
#   (genres @> ARRAY['Adventure','Comedy']) AND
#   ((imdb_data -> 'Rating') >= 7)
# )
```

If you want to avoid repeating `#pg_array` or `#pg_jsonb` in your queries, you can save the array/json expression object into a variable or a constant.

```rb
genres = Sequel.pg_array(:genres)
imdb   = Sequel.pg_jsonb(:imdb)

Movie.where(genres.contains(["Adventure", "Comedy"]) & (imdb['Rating'] >= 7))
```

## Other uses

Other than for building queries, Sequel supports the expression API in many other areas where SQL expressions are needed.

For instance, you can use them when creating an index:

```rb
create_table :users do
  primary_key :id

  String   :handle
  DateTime :deleted_at

  index Sequel.function(:lower, :handle),
    name: :users_unique_handle,
    unique: true,
    where: Sequel[:deleted_at] !~ nil

  # CREATE UNIQUE INDEX users_unique_handle
  # ON users (lower(handle))
  # WHERE (deleted_at IS NOT NULL)
end
```

Another example is the `USING` statement when changing column type:

```rb
alter_table :albums do
  set_column_type :artist_id, :integer, using: Sequel[:artist_id].cast(Integer)
  # ALTER COLUMN artist_id SET DATA TYPE integer USING CAST(artist_id AS integer)
end
```

Yet another area where expressions are supported is in Sequel’s [UPSERT method][upsert]:

```rb
Movie
  .insert_conflict(
    update: { imdb: Sequel.pg_jsonb(:imdb).concat(Sequel[:excluded][:imdb]) },
    update_where: Sequel[:year] >= 2000,
  )
  .multi_insert(imported_values)

# INSERT INTO movies VALUES ...
# ON CONFLICT DO
# UPDATE SET imdb = (imdb || excluded.imdb)
# WHERE (year >= 2000)
```

## Conclusion

Sequel’s API for building SQL expressions allows you to consistently stay in Ruby even for very advanced use cases. This has numerous advantages:

* it’s more readable, with different styles to choose from
* it’s more hackable and reusable
* doesn’t require you to look up the correct SQL syntax every time
* eliminates the possibility of SQL injections

We’re much more motivated to use the various features our database has to offer when our database library encourages us to.

[Sequel]: https://github.com/jeremyevans/sequel
[ode to sequel]: https://janko.io/ode-to-sequel/
[Arel]: https://blog.codeship.com/creating-advanced-active-record-db-queries-arel/
[arel-helpers]: https://github.com/camertron/arel-helpers
[Squeel]: https://github.com/activerecord-hackery/squeel
[pg_array_ops]: https://sequel.jeremyevans.net/rdoc-plugins/files/lib/sequel/extensions/pg_array_ops_rb.html
[pg_json_ops]: https://sequel.jeremyevans.net/rdoc-plugins/files/lib/sequel/extensions/pg_json_ops_rb.html
[extensions]: https://sequel.jeremyevans.net/rdoc/files/doc/extensions_rdoc.html
[upsert]: https://sequel.jeremyevans.net/rdoc/files/doc/postgresql_rdoc.html#label-INSERT+ON+CONFLICT+Support
