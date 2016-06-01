---
title: The plugin system of Sequel and Roda
tags: ruby framework orm roda sequel web plugins design
updated: 31.8.2015.
---

When developing gems, often one of the difficult problems to solve is creating
a good ratio between *simplicity*, *convenience* and *flexibility*.

> A **simple** gem is easy to understand, both in public interface and
> internal implementation. This gem is usually more focused and tries not to do
> too much. It often has less LOC and little or no dependencies, which means it
> loads faster and uses less memory.

> A **convenient** gem comes with many features out-of-the-box which
> cover common scenarios, so that users don't have to reimplement them over and
> over again.

> A **flexible** gem provides good defaults, but allows its behaviour to
> be overriden and extended with custom functionality.

By definition simplicity and convenience are inversely proportional; in
order to achieve convenience (by adding features) you have to sacrifice some
simplicity, and vice versa. On top of that your gem also needs to be flexible,
which is more difficult to achieve the more features it has.

By using standard gem design, it's usually *impossible* to achieve a
perfect ratio that will suit everyone. Almost always you will have a group of
people which are missing features X/Y/Z and will turn to another more
featureful gem, or you will have a group which thinks your gem does too much
and will turn to a simpler gem. That's why there is the division between
**Rails** and **Sinatra**, because for some people Rails is too bloated, while
for other people Sinatra is too simple.

What if... what if by default a gem could give you only the essential
functionality, but still ship with lots of additional features which you can
load if you want to. This would be perfect, because then you could choose
exactly how much your gem does, making the gem as simple or as complex as you
want it to be. This would also mean that the community wouldn't have to divide
on different preferences.

The [Sequel] and [Roda] gems in my opinion achieve this utopia, by implementing
a special kind of **plugin system**.

## The plugin system – a design pattern

Plugin systems are not a new thing in the Ruby ecosystem. [Minitest] implements
one, you can write plugins/extensions which Minitest will autodiscover and
integrate into itself. The [RubyGems] gem also implements a similar plugin
system. These plugin systems work great for these gems, but today I want to
talk about a more advanced kind of plugin system, a *design pattern*, found in
Sequel and Roda.

The original idea was invented by the author of [Sequel], but it has today's
form thanks to Jeremy Evans. About a year ago, Jeremy released [Roda], where he
reused this plugin system. I found about this plugin system after switching to
the Roda/Sequel stack, and I want to give you a deep dive into it to show you
exactly how it works and why it is awesome. Note that this is not one of those
dives for purely educational purposes, I want to teach you a very practical and
generic design pattern which you can use in your next gem.

Since Sequel and Roda have a very similar plugin system, it's enough to
demonstrate one of them, so we'll choose Roda. Roda is a web framework that
consists of 3 core classes:

```ruby
class Roda                                    # 1: Roda
  class RodaRequest < Rack::Request; end      # 2: Roda::RodaRequest
  class RodaResponse < Rack::Response; end    # 3: Roda::RodaResponse
end
```

(If it's eating you up inside why isn't it `Roda::Request` and
`Roda::Response`, [see the reasoning].)

I think the best way to show you Roda's plugin system is to incrementally
design it with you, so that you can see every step and the logic behind it,
which should help you understand it better as a whole.

### Plugins

We want to design a plugin system where "plugins" can add new features to Roda.
In other words, they need to be able to extend Roda's functionality. And since
a gem's functionality is defined entirely by it's methods and classes, our
"plugins" simply need to be able to override instance and class methods for
each class in Roda. ♣︎

Now we just have to define what exactly a "plugin" will be. Since we want a
"plugin" to be an individual, isolated unit of behaviour, it makes sense that
it's a Ruby module. ◆

With ♣︎ and ◆ in mind, let's define a `Roda.plugin` method that applies a
given plugin:

```ruby
class Roda
  def self.plugin(plugin)
    include plugin::InstanceMethods if defined?(plugin::InstanceMethods)
    extend plugin::ClassMethods if defined?(plugin::ClassMethods)

    RodaRequest.include plugin::RequestMethods if defined?(plugin::RequestMethods)
    RodaRequest.extend plugin::RequestClassMethods if defined?(plugin::RequestClassMethods)

    RodaResponse.include plugin::ResponseMethods if defined?(plugin::ResponseMethods)
    RodaResponse.extend plugin::ResponseClassMethods if defined?(plugin::ResponseClassMethods)
  end
end
```
```ruby
Roda.plugin MyPlugin
```

Now we can make a plugin override any Roda class simply by defining a
corresponding "Methods" module inside that plugin (just a reminder that
`plugin` is a module, so `plugin::` simply references a constant inside that
module). Notice that it was an important design decision to limit Roda to only
a few core classes, because now they can all be first-class citizens.

### Overriding

Plugins can now add new methods to Roda's core classes, but we also want to
support overriding existing methods. Specifically, we want that a plugin can
override any method and be able to call `super` to get the original behaviour.
Why do we want to allow overriding? Imagine there is a `#render` method for
rendering templates, and you want to make a plugin for caching those templates.
It would be nice if you could override `#render`, and return the cached version
if it's available, otherwise do the actual rendering, caching the result. As
you can see, plugins could greatly benefit from this ability.

First notice that our plugins can already override each other's behaviour
(because of how module inheritance works), which is what we want. What's left
for achieving complete extensibility is to allow plugins to also override
Roda's core behaviour, the one Roda has without loading any plugins.

The problem is that, if this core behaviour is defined directly on core
classes, it is not possible for a plugin to override it:

```ruby
class Roda
  # This method cannot be overriden with `Roda.extend MyPlugin::ClassMethods`
  def self.route(&block)
    # ...
  end
end
```

This is because plugins use module inclusion, which cannot override direct
method definitions, because included modules follow the same rules as
superclasses.

If you thought about [`Module#prepend`], it would work (thanks @jrochkind for
the [correction]), but it would bump Roda's required Ruby version to 2.0 or
higher. And also, there is no equivalent for `Module#extend`, so we would have
to call `singleton_class.prepend MyPlugin::ClassMethods`, which isn't
pretty.

There is a more elegant solution. We previously established that plugins can
already override each other. What if we then make the core functionality
*itself* a plugin (a "base" plugin), which automatically gets applied when Roda
is required?

```ruby
class Roda
  module RodaPlugins
    module Base
      module ClassMethods ... end
      module InstanceMethods ... end
      module RequestMethods ... end
      module RequestClassMethods ... end
      module ResponseMethods ... end
      module ResponseClassMethods ... end
    end
  end

  plugin RodaPlugins::Base
end
```

Now all plugins can override the core behaviour ("Base"), because it's a plugin
like any other. This is roughly how Roda is implemented. All of Roda's
behaviour is contained in the "Base" plugin (*even* the `Roda.plugin` method),
which gives plugins the ability to override *any* part of Roda.

### Requiring

Ok, at this point we solved extending and overriding Roda with plugins, which
is really the meat of the plugin system. Now we would like to be able to put
plugins into separate files, so that they're required only if the user wants
them. Let's extend `Roda.plugin` with the ability to load plugins by symbols,
which first requires the plugin by requiring `"roda/plugins/#{name}"` (and then
applies it):

```ruby
class Roda
  def self.plugin(plugin)
    plugin = RodaPlugins.load_plugin(plugin) if plugin.is_a?(Symbol)
    # ...
  end

  module RodaPlugins
    @plugins = {}

    def self.load_plugin(name)
      require "roda/plugins/#{name}"
      raise "Plugin didn't correctly register itself" unless @plugins[name]
      @plugins[name]
    end

    # Plugins need to call this method to register themselves:
    #
    #   Roda::RodaPlugins.register_plugin :render, Render
    def self.register_plugin(name, mod)
      @plugins[name] = mod
    end
  end
end
```
```ruby
Roda.plugin :render
Roda.plugin :caching
```

There is another way we could've approached this, that instead of doing
`Roda.plugin :render` we simply `require "roda/plugins/render"`, and then *that
file* should call `Roda.plugin` as soon as it defines the plugin. However, in
this way it wouldn't be possible to configure the plugins (see the next
section).

Roda has only 450 LOC of core and no extra dependencies, so it requires
blazing-fast. In total with plugins it has 3350 LOC, but you can simply choose
how much of that you want to require. Notice that `roda/plugins/#{name}` is
being required from the *load path*, so Roda will load any external plugins
shipped as gems in the same way it loads its own core plugins.

### Configuration

Finally, it would be nice if the plugins were configurable, and able to load
any other plugins they might potentially depend on:

```ruby
class Roda
  def self.plugin(plugin, *args, &block)
    plugin = RodaPlugins.load_plugin(plugin) if plugin.is_a?(Symbol)
    plugin.load_dependencies(self, *args, &block) # <---------------
    include plugin::InstanceMethods if defined?(plugin::InstanceMethods)
    extend plugin::ClassMethods if defined?(plugin::ClassMethods)
    RodaRequest.include plugin::RequestMethods if defined?(plugin::RequestMethods)
    RodaRequest.extend plugin::RequestClassMethods if defined?(plugin::RequestClassMethods)
    RodaResponse.include plugin::ResponseMethods if defined?(plugin::ResponseMethods)
    RodaResponse.extend plugin::ResponseClassMethods if defined?(plugin::ResponseClassMethods)
    plugin.configure(self, *args, &block) # <-----------------------
  end
end
```

We load the plugin's dependencies before we apply its behaviour, so that the
plugin can also load other plugins as its dependencies and be able to override
their behaviour. We also provide a configuration method so that we can
configure the plugin when loading it.

The above is roughly how `Roda.plugin` really looks like, with the addition
of handling `Roda` subclassing and freezing for thread-safety.

## Overview

Let's see again what we gain with this kind of plugin system. We are able to
give the gem a very small core providing only the essentials, but still ship
with additional features as plugins that users can load if they want to. These
features are logically and physically separated from each other (e.g.
rendering, caching, assets, flash, websockets etc.), which produces a nice and
readable modular design.

These plugins allow us to override any part of Roda, including other plugins,
which maximizes the range of plugins we can write. Since Roda's behaviour is
split into plugins and applied by module inclusion, all methods are nicely
introspectable:

```ruby
require "roda"
Roda.plugin :render
Roda.instance_method(:render).owner           # Roda::RodaPlugins::Render::InstanceMethods
Roda.instance_method(:render).source_location # ~/.rbenv/.../roda/plugins/render.rb:213
```

I did see a somewhat similar pattern in [CarrierWave] \(and some other gems),
where the functionality is also stacked with module inclusion. But these
modules aren't clearly divided into features, and even if they were, you cannot
decide which ones to pick (they're all included).

### Standard gem design

Finally, I want to briefly mention when the "plugin system" design pattern can
work better than standard gem design. If you know your gem will be small and
focused, obviously there is no need to introduce this pattern. However, if you
think that your gem will likely grow (e.g. an "uploader" gem), then using this
pattern can really improve the quality of the gem's design.

One alternative to this pattern is providing the ability to simply `require`
additional features of a gem. There is maybe a possibility that this could
work, but ActiveSupport is an example where this idea really failed:

1. **Some files forgot to require all their dependencies** – This oversight is
   understandable, since it's impossible to test this if you run your tests in
   the same processs. Jose Valim wrote an isolated test runner for Rails, and
   [found huge amounts of missing requires in ActiveSupport].
2. **Some features are not clearly divided** – I once wanted to require
   the `1.day.ago` helpers in my non-Rails project, and it took me a lot of
   source code diving to figure out how (and now I forgot again how to do it).
3. **Some features are entangled with dependencies** – Once you figure out how
   to require the `1.day.ago` helpers, it turns out you have to require 5000
   LOC, even though the feature itself only has [200 LOC].

## Conclusion

By designing your gem using this "plugin system" pattern, you can give your
users all the simplicity they want, and at the same time all the features they
want. If you start working on your next big gem, consider using this pattern.

## Related reading

* [http://sequel.jeremyevans.net/rdoc/files/doc/model_plugins_rdoc.html](http://sequel.jeremyevans.net/rdoc/files/doc/model_plugins_rdoc.html)
* [http://roda.jeremyevans.net/rdoc/files/README_rdoc.html#label-Plugins](http://roda.jeremyevans.net/rdoc/files/README_rdoc.html#label-Plugins)
* [http://twin.github.io/ode-to-sequel/](http://twin.github.io/ode-to-sequel/)
* [http://twin.github.io/introduction-to-roda/](http://twin.github.io/introduction-to-roda/)


[sequel]: https://github.com/jeremyevans/sequel
[roda]: https://github.com/jeremyevans/roda
[previous post]: http://twin.github.io/introduction-to-roda/
[see the reasoning]: http://roda.jeremyevans.net/rdoc/files/README_rdoc.html#label-Pollution
[carrierwave]: https://github.com/carrierwaveuploader/carrierwave/blob/master/lib/carrierwave/uploader.rb
[minitest]: https://github.com/seattlerb/minitest#writing-extensions
[rubygems]: http://guides.rubygems.org/plugins/
[found huge amounts of missing requires in ActiveSupport]: https://github.com/rails/rails/commit/f28bd9557c669cd63c31704202a46dd83f0a4102
[`Module#prepend`]: http://dev.af83.com/2012/10/19/ruby-2-0-module-prepend.html
[200 LOC]: https://github.com/janko-m/as-duration
[correction]:  http://twin.github.io/the-plugin-system-of-sequel-and-roda/#comment-2227674746
