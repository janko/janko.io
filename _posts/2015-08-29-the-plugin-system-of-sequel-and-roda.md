---
layout: post
title: The plugin system of Sequel and Roda
author: janko
tags: ruby framework orm roda sequel web plugins design
---

When developing gems, often one of the difficult problems to solve is creating
a good ratio between *simplicity*, *convenience* and *flexibility*.

> A <u>**simple**</u> gem is easy to understand, both in public interface and
> internal implementation. This gem is usually more focused and tries to only
> do what it needs to. It often has less LOC and has little or no dependencies,
> which means it loads faster and uses less memory.

> A <u>**convenient**</u> gem comes with many features out-of-the-box which
> cover common scenarios, so that users don't have to reimplement them over and
> over again.

> A <u>**flexible**</u> gem provides good defaults, but allows its behaviour to
> be overriden and extended with custom functionality.

By definition simplicity and convenience are inversely proportional; in
order to achieve simplicity you have to sacrifice some convenience, and vice
versa. On top of that your gem also needs to be flexible, which is more
difficult to achieve the more features the gem has.

By using standard gem design, it's pretty much *impossible* to achieve a
perfect ratio that will suit everyone. Almost always you will have a group of
people which are missing features X/Y/Z and will turn to another more
featureful gem, or you will have a group which thinks your gem does too much
and will turn to a simpler gem. That's why there is the division between
**Rails** and **Sinatra**, because for some people Rails is too bloated, while
for other people Sinatra is too simple.

What if... what if by default a gem could give you only the essential
functionality, but still ship with additional features which you can load if
you want to. This would be perfect, because then you could choose exactly how
much your gem does, making the gem as simple or as complex as you want it to
be. This would also mean that the community wouldn't have to divide on
different preferences.

The [Sequel] and [Roda] gems in my opinion achieve this utopia, by implementing
a "**plugin system**".

## The plugin system

The plugin system of Sequel and Roda is a gem design pattern; it was first
invented in Sequel, and later the idea was reused in Roda. This pattern is
generally unkown in the Ruby community, I studied it while using Sequel and
Roda, and was amazed by how powerful it is. I want to give you a deep dive into
it and show you exactly how it works and why it is awesome. This is not one of
those dives for purely educational purposes, this is a very practical and
generic pattern which you can use in your next gem.

Since Sequel and Roda have a very similar plugin system, it's enough to
demonstrate one of them, so we'll choose Roda. I think the best way to show you
Roda's plugin system is to incrementally design it with you, so that you can
see every step and the logic behind it, which should help you understand it
better as a whole.

Roda is a web framework that consists of 3 core classes:

```rb
class Roda                                    # 1: Roda
  class RodaRequest < Rack::Request; end      # 2: Roda::RodaRequest
  class RodaResponse < Rack::Response; end    # 3: Roda::RodaResponse
end
```

### A plugin

We want to design a plugin system where "plugins" can extend and override
Roda's behaviour. Since a gem's behaviour is entirely defined by it's methods
and classes, our "plugins" simply need to be able to override instance and
class methods for each class in Roda.

Let's define what exactly a "plugin" will be. Since we want a "plugin" to be an
individual, isolated unit of behaviour, it makes sense to package it as Ruby
module.

We can now define a `Roda.plugin` method, which applies a given plugin:

```rb
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
```rb
Roda.plugin MyPlugin
```

This is a pretty direct and straightforward implementation of what we'd
discussed just now. Now if we want a plugin to override a certain Roda class,
we simply need to define a module inside it with the appropriate name (remember
that `plugin` is a Ruby module, so `plugin::` simply references a constant
inside that module). As you see, this is why it's an important design decision
to limit yourself to only a few core classes, because now they can all be
first-class citizens.

### Overriding

This plugin system obviously solves adding new methods to Roda's core classes,
but I want to explain exactly how does it solve overriding existing methods.
Firstly, plugins can already override each other, because of how module
inheritance works – if an included module defines a method, any afterwards
included module can override that method and call `super` to get the original
behaviour.

What's left is to allow plugins to override Roda's core behaviour. Firstly, if
this core behaviour is defined directly on core classes, it is not possible to
override it:

```rb
class Roda
  # BAD: We cannot override this method with `Roda.extend SomeModule`
  def self.route(&block)
    # ...
  end
end
```

This is because direct method definitions always have the highest priority in
Ruby's inheritance chain, so that you're always able to override superclass' or
included modules' behaviour.

Secondly, it might be tempting to just call `super` inside of `Roda.route`, so
that we call any plugin behaviour that might have been included. But this is
wrong for 3 reasons: **a)** we would have to call `super` in every method we
define in the core, **b)** `super` will fail if no plugin has overriden that
method, so we would have to handle that case, and **c)** we actually want it
the other way around, we want *plugins* to be able to call `super` when
overriding behaviour.

Thirdly, it might also be tempting to use `Module#prepend` introduced in Ruby
2.0. This *almost* works, but it doesn't for 2 reasons: **a)** plugins wouldn't
be able to override methods inherited from subclassed `Rack::Request` and
`Rack::Response`, because of where `Module#prepend` positions the module, and
**b)** there isn't an equivalent for `Module#extend`, so then you would have to
use `Roda.singleton_class.prepend ClassMethods`, which isn't pretty.

There is a much simpler solution. We previously established that plugins can override each other. What if we then
make the core functionality *itself* a plugin (a "base" plugin), which
automatically gets loaded when Roda is required?

```rb
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

This is roughly how Roda is implemented. All of Roda's behaviour is contained
in the "Base" plugin (*even* the `Roda.plugin` method), which gives plugins the
ability to override *any* part of Roda.

### Requiring

Ok, at this point we solved extending and overriding Roda with plugins, which
is really the meat of the plugin system. Now we would like to be able to put
plugins into separate files, so that they're required only if the user wants
them. Let's extend `Roda.plugin` with the ability to load plugins by symbols,
which will conveniently load `"roda/plugins/#{name}"` from the load path (so
this plugin can be in the Roda gem, or in an external gem) and apply
the required plugin:

```rb
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
```rb
Roda.plugin :render
Roda.plugin :caching
```

Roda has only 450 LOC of core and no extra dependencies, so it requires
blazing-fast. In total with plugins it has 3350 LOC, but you can simply choose
how much of that you want to require.

### Configuration

Finally, it would be nice if the plugins were configurable, and that they
are able to load any other plugins they potentially depend on:

```rb
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

We load dependency plugins before we include/extend the modules, because the
plugin will potentially want to override its dependency plugins. We also
provide a configuration method, where the plugin can accept additional options
for its functionality.

The above is roughly how `Roda.plugin` actually looks like, with the addition
of handling `Roda` subclassing and freezing for thread-safety.

## Overview

Let's see again what we gain with the plugin system pattern. We are able to
give the gem a very small core providing only the essentials, but still provide
the ability to load additional features via plugins (which will only be
`require`d if the user needs them).

These plugins allow us to override any part of Roda and also other plugins,
which gives us maximum flexibility. Since all methods come from module
inclusion, they are nicely introspectable:

```rb
require "roda"
Roda.plugin :render
Roda.instance_method(:render).owner           # Roda::RodaPlugins::Render::InstanceMethods
Roda.instance_method(:render).source_location # ~/.rbenv/.../roda/plugins/render.rb:213
```

This design pattern allows us to approach gem design in a new way. With the
standard design it happens that one part of the method/class belongs to one
feature, and the other to another feature. Also, your gem can quickly start to
grow out of proportions, which you may then try to solve with autoloading, which
sucks. The plugin system motivates you to identify the essential functionality
of your gem, and allows you to build your gem by adding features which are and
logically and physically separated from each other, producing nice and readable
modular design.

## Conclusion

By designing your gem using the plugin system pattern, you give your users all
the simplicity they want, and at the same time all the features they want. If
you start working on your next big gem, consider using this pattern, it can
really improve the quality of your design.

## Related reading

* [http://sequel.jeremyevans.net/rdoc/files/doc/model\_plugins\_rdoc.html](http://sequel.jeremyevans.net/rdoc/files/doc/model_plugins_rdoc.html)
* [http://roda.jeremyevans.net/rdoc/files/README_rdoc.html#label-Plugins](http://roda.jeremyevans.net/rdoc/files/README_rdoc.html#label-Plugins)
* [http://twin.github.io/ode-to-sequel/](http://twin.github.io/ode-to-sequel/)
* [http://twin.github.io/introduction-to-roda/](http://twin.github.io/introduction-to-roda/)


[sequel]: https://github.com/jeremyevans/sequel
[roda]: https://github.com/jeremyevans/roda
[previous post]: http://twin.github.io/introduction-to-roda/
