---
title: Introduction to Roda
tags: ruby framework rails roda web
updated: 19.8.2015.
---

When I decided that I want to move away from Rails, I have investigated
and experimented with a lot of other Ruby web frameworks (Sinatra, Grape and
Lotus), but this one really stood out in every regard, and it became my
framework of choice. That's why I want to show it to you.

[Roda] is a web framework built on top of Rack, created by Jeremy Evans, that
started as a fork of [Cuba] and was inspired by [Sinatra]. The following is the
simplest app you can make in Roda, which returns "Hello world!" for every
request:

```ruby
# config.ru
require "roda"
Roda.route { "Hello world!" }
run Roda.app
```

Let's explain what the official Roda description means:

> Roda is a **routing tree** web framework **toolkit**.

## The routing tree

Roda (and Cuba) have a very unique approach to routing compared to Rails,
Sinatra and other Ruby web frameworks. In Roda you route incoming requests
dynamically as they come.

```ruby
class App < Roda
  route do |r| # the request object
    r.on "albums" do
      r.is "recent" do
        r.get do
          @albums = Album.recent
        end
      end
    end
  end
end
```

Let's see what's going on here. First, we subclass `Roda` (the same way we
subclass `Sinatra::Base` or `Rails::Application`). The `route` block is called
whenever a new request comes in. It is yielded an instance of a subclass of
`Rack::Request` with some additional methods for matching routes. By
convention, this argument is named `r` (for "request").

Firstly, if the path of the request starts with "/albums", the request will be
matched by the `r.on` call, calling the given block. Next it will be matched by
the `r.is` call if the path continues and ends with "/recent" (`r.is` is a
terminal matcher). Finally, `r.get` will match only GET requests. Altogether,
this `route` block handles `GET /albums/recent` requests by assigning a list of
recent albums.

The reason why this is called a "routing *tree*" is because routing is
branched. If the request doesn't start with "/albums", the whole `r.on
"albums"` block ("branch") is immediately discarded and routing continues to
next branches.

Ok, so far this looks like a flavor of Grape with a weird syntax. But the
difference is that the `route` block is called each time a request is made, so
this routing is actually happening in real-time. This means that **you can
handle the request while you're routing it**. And this is where it gets cool.

```ruby
class App < Roda
  plugin :all_verbs

  route do |r|
    r.on "albums" do
      require_login!

      r.is ":id" do |id|
        @album = current_user.albums.find(id)

        r.get do
          @album
        end

        r.put do
          @album.update(r.params["album"])
        end

        r.delete do
          @album.destroy
        end
      end
    end
  end
end
```

Since all of these 3 "/albums/:id" routes have to first find the album, we can
assign the album as soon as we know that the path is going to be "albums/:id",
and then we reference it anywhere down that branch. We can also require login
for any "/albums\*" requests. In other web frameworks you would solve this with
before filters in order to avoid duplication, but that splits code that should
be together into different lexical scopes, making it harder to follow. With
Roda you can write DRY code in a very readable way.

This is a new concept, and it opens a whole new world of routing possibilities.
From other web frameworks we are used to routing only by the request path and
method. But why not also route by request *headers* or *parameters*?

```ruby
class App < Roda
  plugin :header_matchers
  plugin :symbol_matchers

  route do |r|
    # If the "Authorization" header is set, we return that user's posts
    r.get "posts", header: "HTTP_AUTHORIZATION" do
      @posts = current_user.posts
    end

    # Otherwise we return all posts
    r.get "posts" do
      @posts = Post.all
    end

    # Matches "/" if the "mobile" query parameter is passed in
    r.root param: "mobile" do
      # Matches "?mobile=true"
    end

    # We can do whatever we want, even throw in some conditionals
    if current_user.admin?
      run MonitoringApp # routes the request to the Rack application
    end
  end
end
```

As you can see, Roda's routing tree is very powerful, because you have the
complete control. But if you don't like it, you can just [use Roda like
Sinatra][class_level_routing].

## A toolkit

By design, Roda has a very small [core] \(450 LOC\) providing only the essentials.
All additional features are loaded via [plugins] that ship with Roda. This is
why Roda is a "web framework *toolkit*", using a combination of Roda plugins
you can build your own flavor of the web framework that suits your needs, and
choose exactly the amount of complexity you need.

In my opinion, this is much better than Cuba's philosophy, where the gem
consists only of a small core, and doesn't contain any plugins by itself. You
will always need more functionality than the 250 LOC that Cuba gives you, but
it's not easy to search for external plugins which are scattered all around.
Roda ships with lots of awesome plugins for everyday situations, which are
maintained with the same level of quality as Roda itself, so you'll rarely need
external ones.

Roda comes with over 60 plugins built in, so I want to show you some highlights.

### [Render] & [Assets]

The "render" plugin adds support for template rendering using [Tilt], and
the "assets" plugin adds asset (pre)compilation and management (also using
Tilt).

```ruby
plugin :render, engine: "haml"
plugin :assets, css: "app.css", js: "app.js"

route do |r|
  r.assets # adds routes to your assets

  r.is "foo"
    view "foo" # renders views/foo.haml inside views/layout.haml
  end

  r.is "bar"
    view "bar" # renders views/bar.haml
  end
end
```

### [Json]

Like Sinatra, Roda uses the return value of the block as the response body. But
unlike Sinatra, Roda knows what's been returned in the block, and with the
"json" plugin you can add automatic JSON serialization for those values.

```ruby
plugin :json, classes: [Array, Hash, ActiveRecord::Base, ActiveRecord::Relation],
  serializer: proc { |object|
    case object
    when Array, Hash
      object.to_json
    else
      Serializer.new(object).as_json
    end
  }

route do |r|
  r.get "albums/recent" do
    Album.recent
  end

  r.get "albums/:id" do |id|
    Album.find(id)
  end
end
```

### [Websockets]

Roda has Websocket support using [faye-websocket].

```ruby
plugin :websockets

route do |r|
  r.get "room" do
    # Matches if the "/ping" request is a websocket request
    r.websocket do |ws|
      ws.on(:message) { ... }
      ws.on(:close) { ... }
      # ...
    end

    # If the request is not a websocket request, execution continues and in
    # that case we render a template
    view "room"
  end
end
```

### [Caching]

The "caching" plugin adds helper methods for setting HTTP caching headers.

```ruby
plugin :caching

route do |r|
  r.get "albums" do
    r.last_modified Album.max(:updated_at)
    @albums = Album.all
  end

  r.get "albums/:id" do |id|
    @album = Album.find(id)
    r.etag @album.sha1
  end

  r.get "albums/popular" do
    @albums = Album.popular
    response.cache_control public: true, max_age: 60 # HTTP/1.1
    response.expires 60                              # HTTP/1.0
  end
end
```

### [Path]

The "path" plugin adds support for named paths (similar to Rails).

```ruby
plugin :path

# static
path :albums, "/albums"
# with an argument
path(:album) { |album| "/albums/#{album.id}" }
# polymorphic
path(Artist) { |artist, *paths| "/artists/#{artist.id}/#{paths.join("/")}" }

route do |r|
  r.post "albums" do
    album = Album.create(r.params["album"])
    r.redirect album_path(album) # /albums/1
  end

  r.delete "albums/:id" do |id|
    Album.destroy(id)
    r.redirect albums_path # /albums
  end

  r.get "artists/:id" do |id|
    artist = Artist.find(id)
    r.redirect path(artist, "albums", "top") # /artists/1/albums/top
  end
end
```

### [Sinatra helpers]

This plugin ports most of the helper methods defined in Sinatra::Helpers to
Roda, which is awesome if you're transitioning from Sinatra.

```ruby
plugin :sinatra_helpers
```

This will fill your app's instance methods, which you can then use in the
`route` block.

```ruby
# Request methods
redirect back
error 500, "Invalid parameters"
not_found "The record was not found"
send_file "path/to/file.txt"

# Response methods
body "Winter is coming"
status 301
mime_type :json

# And more...
```

## Limitations & Caveats

One downside of using Roda's routing tree is that, since routes are not stored
in any data structure (because requests are routed dynamically as they come
in), you cannot introspect the routes of the routing tree. In other words, it's
not possible to implement a `rake routes` task.

However, you can leave comments above your routes using a special syntax, and use
the [roda-route_list] plugin/command-line tool to parse those comments and print
the routes.

Another caveat that you should be careful about when using Roda's routing
tree is that, if you handled the request, you should always explicitly return a
string that will be written as the response body. For example, a `POST
/contact` request to the following app would return a 404:

```ruby
require "mail"

class App < Roda
  route do |r|
    r.post "contact" do
      Mail.deliver { ... }
    end
  end
end
```

This is because `Mail.deliver` returns an instance of `Mail::Message`, and since
it isn't a String, Roda ignores that value and considers the branch unhandled.
The correct thing to do in this case is to return `""` at the end of the block.
After a [discussion] with Jeremy Evans I realized that, because of the dynamic
nature of the routing tree, it's good that Roda forces you to explicitly state
that you handled the request.

## Conclusion

I'm really amazed by Roda's design, how carefully the framework was thought
through, and the arsenal of its features (I only covered 1/10 of Roda's
plugins). I love the completely new approach to routing with the routing tree,
I think this power becomes more and more useful as the application grows in
complexity. I use Roda because I found it to be the most advanced framework,
while still having this perfect simplicity that I always wanted.

[roda]: https://github.com/jeremyevans/roda
[cuba]: https://github.com/soveran/cuba
[sinatra]: https://github.com/sinatra/sinatra
[class_level_routing]: http://roda.jeremyevans.net/rdoc/classes/Roda/RodaPlugins/ClassLevelRouting.html
[plugins]: http://roda.jeremyevans.net/documentation.html#included-plugins
[core]: https://github.com/jeremyevans/roda/blob/master/lib/roda.rb
[render]: http://roda.jeremyevans.net/rdoc/classes/Roda/RodaPlugins/Render.html
[assets]: http://roda.jeremyevans.net/rdoc/classes/Roda/RodaPlugins/Assets.html
[json]: http://roda.jeremyevans.net/rdoc/classes/Roda/RodaPlugins/Json.html
[websockets]: http://roda.jeremyevans.net/rdoc/classes/Roda/RodaPlugins/Websockets.html
[caching]: http://roda.jeremyevans.net/rdoc/classes/Roda/RodaPlugins/Caching.html
[path]: http://roda.jeremyevans.net/rdoc/classes/Roda/RodaPlugins/Path.html
[sinatra helpers]: http://roda.jeremyevans.net/rdoc/classes/Roda/RodaPlugins/SinatraHelpers.html
[symbol matchers]: http://roda.jeremyevans.net/rdoc/classes/Roda/RodaPlugins/SymbolMatchers.html
[tilt]: https://github.com/rtomayko/tilt
[faye-websocket]: https://github.com/faye/faye-websocket-ruby
[roda-route_list]: https://github.com/jeremyevans/roda-route_list
[discussion]: https://groups.google.com/forum/#!topic/ruby-roda/JbQi5SxL49A
