---
layout: post
title: Evaluating (Ruby) Libraries
author: janko
tags: ruby gem library
---

Whenever we need to solve a problem in our application, if this problem is
common enough, chances are there are already libraries out there which can help
us with that. Great, now we just pick the library with most GitHub stars, and
start integrating it into our project. So, the next thing—

Wait. Wait just a minute. It's great that there is a popular library for the
functionality that we need, but we should be careful with our choice. Whatever
library we choose, we'll have to take the time to learn it and integrate it
into our codebase. If this library later starts causing pain as our
requirements grow, it is likely that at that point it's already deeply
integrated into our codebase, making switching to another library difficult.

In order to save time later, we should invest some time upfront in choosing the
right library (even web frameworks or ORMs). It's good to make a list of all
active libraries which solve this same problem ([awesome-ruby] can help here),
and then evaluate them using different criteria than just popularity; libraries
that are more popular don't necessarily have to be better.

In this post I want to talk about which criteria I use when evaluating Ruby
libraries, and which ones I consider more valuable than others. For illustration
I will also mention concrete libraries that I prefer and why.

## More valuable criteria

### Features & Flexibility

The most important criteria for me is how much the library can do;
specifically, can the library satisfy my current requirements, and potential
future requirements that come to mind. If library **A** allows me to do more
than library **B**, I will almost always pick library **A**.

When it comes to choosing an ORM, I will always choose [Sequel] over
ActiveRecord, simply because [you can do more with it]. One example (out of
many) where this decision rewarded me: I knew that Sequel allows queries to
return plain Ruby hashes/arrays instead of model instances, and there was one
case where I was implementing an iterative algorithm, and just switching from
model instances to plain hashes/arrays made my algorithm 3x faster.

{% highlight ruby %}
Movie.where{rating > 4}.to_a       #=> [#<Movie>, #<Movie>, ...]
DB[:movies].where{rating > 4}.to_a #=> [{...}, {...}, ...]
{% endhighlight %}

When it comes to choosing a web framework, [Roda] is my first choice. The
reason why I don't choose Rails is because, even though Rails is really big and
complex, I don't actually find it to be very advanced in terms of handling
requests, which is the main purpose of a web framework. With Roda's ability
to handle incoming requests while routing them, I have the ultimate flexibility
which opens so many doors. For example, if I want to add authorization for a
mounted Rack endpoint, this is how I would do it in Roda:

{% highlight ruby %}
class App < Roda
  plugin :halt
  plugin :render

  route do |r| # yielded on each incoming request
    r.on "videos" do
      authorize!(:upload)
      r.run VideoUploader::UploadEndpoint
    end
  end

  def authorize!(role)
    request.halt 403, render(:unauthorized) if authorized?(current_user, role)
  end
end
{% endhighlight %}

I have no idea how I would do that in Rails. We cannot be inside any
controller, because the endpoint is what handles the request, so we have
to do it in "nowhere land" that are Rails routes:

{% highlight ruby %}
Rails.application.routes.draw do
  upload_authorization = ->(request) do
    if (id = request.session[:user_id]) && (current_user = User.find(id))
      return true if Authorization.call(current_user, :upload)
      throw :halt, [403, response.headers, [ApplicationController.render(:unauthorized)]]
    end
  end
  constraints upload_authorization do
    mount VideoUploader::UploadEndpoint, to: "/videos"
  end
end
{% endhighlight %}
{% highlight ruby %}
class HaltRequests
  def initialize(app)
    @app = app
  end

  def call(env)
    catch(:halt) do
      @app.call(env)
    end
  end
end

Rails.application.config.middleware.use HaltRequests
{% endhighlight %}

Gross. In the `constraints` block we're not inside of any controller, so we
have to reimplement authentication and authorization logic. Moreover, unlike
Roda and Sinatra, Rails doesn't have a feature of halting requests, so we have
to implement that as well. No thanks, I'm sticking with Roda.

### Generic

If the problem the library is solving is generic, then the library should be
usable in any web framework. I know, I'm biased being a Ruby-off-Rails
developer, which means I literally cannot use any Rails-specific gems. And most
of you who are reading this are Rails developers, so why should you care?
Well, since it seems people are increasingly using other Ruby web frameworks,
I think it's future-proof to center around libraries that *everyone* can use.

For example, for authentication and account management I believe even Rails
developers should consider choosing [Rodauth] over Devise. Rodauth is an
authentication and account management framework which is written in Roda and
Sequel, but can be used with *any web framework* and *any ORM*. Rodauth
achieves this by giving you a DSL to generate a Rack app that encapsulates
all authentication logic, which you can then use as a middleware in your
application:

{% highlight ruby %}
class Authentication < Roda
  plugin :rodauth do
    enable :login, :logout, :create_account, :verify_account, :close_account
  end

  route do |r|
    r.rodauth # handles all authentication routes

    r.on "admin" do
      rodauth.require_authentication # halts the request if unauthenticated
      # user is authenticated, so let the request go through to Rails
    end
  end
end
{% endhighlight %}
{% highlight ruby %}
Rails.application.config.middleware.use Authentication
{% endhighlight %}

### Design

The library also needs to be well-designed (good design usually brings more
features). This might a bit difficult to evaluate before actually using the
library, but I think it's important to be able to easily understand how the
library works and what are its main components. If the library doesn't have
good design, it will likely be difficult to maintain and to add more advanced
features, and eventually the maintainer(s) could likely lose motivation to
contribute to the library.

To continue on the previous example, [Rodauth] is much better designed than
Devise. For example, Devise's configuration is scattered across five different
places: the initializer, models, routes, your controllers, and Devise's
controllers. In Rodauth the whole authentication logic is encapsulated inside a
single `Roda` subclass, and everything can be configured via the same DSL.

Rodauth was able to be born thanks to Roda and Sequel both also having great
designs (and thus features as well). Rodauth couldn't have been implemented
using Rails, because with Rails you cannot create mountable Rack apps (as far
as I know), and it couldn't have been implemented using ActiveRecord, because
ActiveRecord doesn't support model-less queries (Rodauth's design uses separate
tables for separate features for performance and simplicity), or
database-agnostic timestamp operations needed for 2FA.

### Activity

It's very important that a library is being actively maintained. If the
maintainer is only merging pull requests, that is still classified as
"maintenance". When scanning library's activity, I'll often find it a bit
alarming if I see a legit issue that hasn't been solved for months.

Now, issues not being solved could be due to lack of time from maintainers.
But it could also be due to lack of motivation; I've often seen maintainers
abandoning their projects to later start a new and better one. So, while not
always, lack of activity on the library might tell something about quality.

It's also important for me that new versions of libraries are regularly
released. I really like Jeremy Evans' monthly release cycle, in which he tries
to release a new version every month with whatever is currently on master.
This is also for me another downside of ActiveRecord; patch releases are
relatively frequent, but minor releases are approximately every 5-6 months,
which is a very long time. And if you want to pull latest ActiveRecord from
master, with it you also have to pull the *whole Rails* from master, which can
be very inconvenient.

## Less valuable criteria

### Familiarity

Often when I'm publicly stating somewhere that Sequel is a better ORM than
ActiveRecord, I get a response that a big advantage of ActiveRecord is that
it's familiar. However, by that logic you should always use the first library
that you ever tried, because it will always be more familiar than any new
library.

I think that *what the library can do* is much more important than how much
you're familar with it. Familiarity can always be "fixed" by reading
documentation and source code, but if the library lacks features and good
design, you cannot easily get around that. I'm not gonna lie, even though
Sequel and ActiveRecord are very similar, deeply understanding Sequel still
took a lot of time (like ActiveRecord did), but it was totally worth it.

### Stars

The amount of stars a library has on GitHub is usually a good measure for its
popularity. However, I've often found that popularity isn't a good indication
of library's quality. I think this is because popularity is an exponential
function; people will often automatically choose a library based on its
popularity, thus increasing its popularity. Then when a new library arises
which solves the problem in a better way, it is difficult to gain popularity.

### Number of maintainers

I learned that some people consider it a downside if a library has only one
maintainer, and that they will rather choose an alternative which has more
maintainers. They are afraid that for whatever reason this maintainer might
stop developing the library, causing the library to die. However, I don't think
this fear is justified. If a library has only one maintainer, that doesn't mean
other people wouldn't be able to maintain it.

For example, Sequel is maintained perfectly: most of the time there are 0 open
issues because they are fixed quickly, and the author additionally helps anyone
at the Sequel Google group. The reason why there aren't more Sequel maintainers
is because they simply wouldn't have anything to do :smiley:.

Even though ActiveRecord has a larger number of contributors, features like
`ActiveRecord::Relation#or` still take 2 years to get merged. So I will always
rather choose Sequel, because it's simply better maintained.

### Rails integration

People often tend to choose library A over library B simply because library A
has a Rails integration. However, I found that the time I spend setting up
libraries with Rails or any other web framework is insignificant compared to
the time it takes to actually develop my application. So I don't think that
Rails integration should be used as any kind of criteria for choosing a
library.

I've sometimes experienced that libraries' "railtie" reveal a lot of complexity
in library's setup. For example, [Devise's Rails integration] among other
things does the following: sets up Warden, extends routes with helper methods,
tweaks route reloading, extends controllers with helper methods, sets up
OmniAuth, and extends models with helper methods. A lot of people would react to
this with: "Wow, Devise is so awesome that it sets up all of this for me". But
I think we should instead ask ourselves why does there need to be so much
complexity.

## Conclusion

I think we should be more mindful about the libraries we choose. The time that
we spend evaluating alternatives is worthwhile considering the time that we'll
save by choosing the right library. We should try not to choose a library just
because it's part of Rails or because its popular, but because we really see the
value of that library over the alternatives.

Make good choices, and you will be greatly rewarded :gift:

[awesome-ruby]: https://github.com/markets/awesome-ruby
[Sequel]: https://github.com/jeremyevans/sequel
[you can do more with it]: http://twin.github.io/ode-to-sequel/
[Roda]: https://github.com/jeremyevans/roda
[Rodauth]: https://github.com/jeremyevans/rodauth
[Devise's Rails integration]: https://github.com/plataformatec/devise/blob/master/lib/devise/rails.rb
