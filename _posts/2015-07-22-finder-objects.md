---
title: Finder Objects
tags: ruby rails orm
---

In Ruby applications it is considered good practice to encapsulate your
ActiveRecord querying logic. To achieve this, it's natural to use ActiveRecord
scopes.

So, instead of this:

```ruby
# app/models/quiz.rb
class Quiz < ActiveRecord::Base
end
```
```ruby
# app/controllers/quizzes_controller.rb
class QuizzesController < ApplicationController
  # BAD
  def index
    quizzes = Quiz.all
    quizzes = quizzes.where(name: params[:q]) if params[:q]
    quizzes = quizzes.where(category: params[:category]) if params[:category]
    quizzes = quizzes.paginate(page: params[:page]) if params[:page]

    render json: quizzes
  end
end
```

It's better to do this:

```ruby
# app/models/quiz.rb
class Quiz < ActiveRecord::Base
  scope :search, -> (params) do
    quizzes = all
    quizzes = quizzes.where(name: params[:q]) if params[:q]
    quizzes = quizzes.where(category: params[:category]) if params[:category]
    quizzes = quizzes.paginate(page: params[:page]) if params[:page]
    quizzes
  end
end
```
```ruby
# app/controllers/quizzes_controller.rb
class QuizzesController < ApplicationController
  # Good
  def index
    render json: Quiz.search(params)
  end
end
```

This makes your controllers oblivious to the querying logic, as they should be.
ActiveRecord scopes have always been convenient for encapsulating your query
logic; they're easily accessible, reusable anywhere in the scope chain, and are
safe kept inside a class which has the appropriate "database" responsibility.

However, there are downsides to putting everything in ActiveRecord scopes:

* They don't bring new behaviour to your models, they are essentially just
  macros for querying.
* As your application grows, the scopes just keep piling up in your ActiveRecord
  models. **And it doesn't have to necessarily mean that your models are
  getting more complex**, it could just mean that you're presenting your data
  in various ways, and that you need a lot of scopes.
* You're limited to scope names that are different than existing ActiveRecord's
  query methods. It may not sound like a big deal, but as your application grows
  you may start minding this lack of freedom.
* You cannot override existing query methods (e.g. `#find`) to do some custom
  logic. By "cannot" I mean that you shouldn't, because you could break
  existing code which is relying on original ActiveRecord functionality. You
  can extend a query method with additional funcionality, but [it may turn out
  to be more work than you hoped][friendly_id].

There is a better way.

## Finder objects

Finder objects are classes which encapsulate querying the database. The idea is
that your controllers always query your records through finder objects, never
through models directly.

You may be more familiar with the term "[Query objects]". These are similar to
finder objects, but the idea seems to be to create one class for each query. I
don't like that, because then you end up with a lot of unmeaningful classes,
it's better to have multiple methods per class.

A generalization of finder objects are "[Repositories]", which encapsulate all
interaction with the database, not just querying. However, I really like the
ActiveRecord pattern, so I don't need repositories, but I *would* like to
extract the querying part.

## Implementation

Suprisingly, I didn't find any examples on the implemenation of finder objects.
I first found out about them in [this presentation][presentation]
held by Simone Carletti from DNSimple. The presentation doesn't contain the
actual implemenation, but it contains enough examples of usage to understand
the main features finder objects should have.

Let's write the simplest finder object:

```ruby
# app/finders/quiz_finder.rb
class QuizFinder
  def self.search(q: nil, category: nil, page: nil)
    quizzes = Quiz.all
    quizzes = quizzes.where(name: q) if q
    quizzes = quizzes.where(category: category) if category
    quizzes = quizzes.paginate(page: page) if page
    quizzes
  end

  def self.published
    Quiz.where(published: true)
  end
end
```
```ruby
QuizFinder.search(q: "game of thrones", category: "movies")
```

This is of course very raw, but it's a good start. We quickly realize we don't
want to repeat the `Quiz` constant for each query method, so we DRY it up:

```ruby
# app/finders/quiz_finder.rb
class QuizFinder
  def self.search(q: nil, category: nil, page: nil)
    quizzes = scope
    quizzes = quizzes.where(name: q) if q
    quizzes = quizzes.where(category: category) if category
    quizzes = quizzes.paginate(page: page) if page
    quizzes
  end

  def self.published
    scope.where(published: true)
  end

  def self.scope
    Quiz.all
  end
end
```

Better. This will be useful later. Ok, now we notice that we cannot reuse query
methods (we cannot use `.published` inside of `.search`), because they both have to
be called on `QuizFinder` which is currently stateless.

Quickly we come to the idea to have `QuizFinder` be instantiated with a scope,
and turn our query methods into instance methods, so we change our
implementation:

```ruby
# app/finders/quiz_finder.rb
class QuizFinder
  def self.method_missing(name, *args, &block)
    new(Quiz.all).send(name, *args, &block)
  end

  def initialize(scope)
    @scope = scope
  end

  def search(q: nil, category: nil, page: nil)
    quizzes = published # we can now reuse this query method
    quizzes = quizzes.where(name: q) if q
    quizzes = quizzes.where(category: category) if category
    quizzes = quizzes.paginate(page: page) if page
    quizzes
  end

  def published
    scope.where(published: true)
  end

  private

  attr_reader :scope
end
```

Notice that we could now reuse `#published` inside of `#search`. We added the
class-level `.method_missing` so that we can still call methods on the
class-level (I find it prettier).

Let's now refactor `#search` to prove that our finder object implementation
works when we increase complexity (we also add `#new` to make the code
more concise).

```ruby
# app/finders/quiz_finder.rb
class QuizFinder
  def self.method_missing(name, *args, &block)
    new(Quiz.all).send(name, *args, &block)
  end

  def initialize(scope)
    @scope = scope
  end

  def search(q: nil, category: nil, page: nil)
    quizzes = published
    quizzes = new(quizzes).from_query(q) if q
    quizzes = new(quizzes).with_category(category) if category
    quizzes = new(quizzes).paginate(page) if page
    quizzes
  end

  def published
    scope.where(published: true)
  end

  def from_query(q)
    scope.where(name: q)
  end

  def with_category(category)
    scope.where(category: category)
  end

  def paginate(page)
    scope.paginate(page: page)
  end

  private

  attr_reader :scope

  def new(*args)
    self.class.new(*args)
  end
end
```

It looks like our implementation scales. The final step is to extract this
functionality out so that we can add other finder objects:

```ruby
# app/finders/base_finder.rb
class BaseFinder
  def self.method_missing(name, *args, &block)
    new(model.all).send(name, *args, &block)
  end

  def self.model(klass = nil)
    if klass
      @model = klass
    else
      @model
    end
  end

  def initialize(scope)
    @scope = scope
  end

  def paginate(page)
    scope.paginate(page: page)
  end

  private

  attr_reader :scope

  def new(*args)
    self.class.new(*args)
  end
end
```
```ruby
# app/finders/quiz_finder.rb
class QuizFinder < BaseFinder
  model Quiz

  def search(q: nil, category: nil, page: nil)
    quizzes = published
    quizzes = new(quizzes).from_query(q) if q
    quizzes = new(quizzes).with_category(category) if category
    quizzes = new(quizzes).paginate(page) if page
    quizzes
  end

  def published
    scope.where(published: true)
  end

  def from_query(q)
    scope.where(name: q)
  end

  def with_category(category)
    scope.where(category: category)
  end
end
```

## Advantages

* Your queries are now completely isolated in their own classes, and aren't
  cluttering your models anymore.
* You now have the complete freedom over the query interface. So you can now
  (re)implement `.find` with confidence that you won't break anything. You can
  also raise "not found" errors whenever you want, and you can choose instead
  of `ActiveRecord::RecordNotFound` to use a custom application-specific error
  (useful when building APIs).
* You can now group your query methods however you want, if your `QuizFinder`
  increases in complexity, you can split it up to multiple finder objects
  (which is much better than splitting ActiveRecord scopes into multiple
  concerns).
* You can now easily impose a rule that **controllers always have to query the
  models through finder objects**, ensuring encapsulation (when using ActiveRecord
  scopes, it can always happen that controller accidentally calls one of
  ActiveRecord's finder methods).

## Conclusion

When your application's complexity increases, your models are usually the ones
who suffer the most from it. Therefore, it is important to figure out which
things don't have to be in the model, but still try to find a way to keep the
inteface convenient. Finder objects are a great way of reducing your models'
complexity.

[friendly_id]: https://github.com/norman/friendly_id/blob/master/lib/friendly_id/finder_methods.rb#L18-L24
[query objects]: http://craftingruby.com/posts/2015/06/29/query-objects-through-scopes.html
[repositories]: https://github.com/lotus/model#repositories
[presentation]: https://speakerdeck.com/weppos/maintaining-a-5yo-ruby-project-shark-edition
