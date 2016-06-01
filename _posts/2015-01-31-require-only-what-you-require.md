---
title: Require only what you require
updated: 12.2.2015.
tags: ruby design
redirect_from: /2015/01/require-only-what-you-require/
---

Writing code which reveals intention is one of the most important things to me. Some time ago, I read "[5 Reasons to Avoid Bundler.require](http://myronmars.to/n/dev-blog/2012/12/5-reasons-to-avoid-bundler-require)" by Myron Marston, which talks about how Rails requires all of your gems at startup and some of the downsides of that approach. After reading it, I started noticing how many gems, when they need to require their parts, use a similar approach as Rails by just requiring everything in one place.

To illustrate, we'll take a look at a library we're all using – Rake.

```ruby
# lib/rake.rb

require 'rbconfig'
require 'fileutils'
require 'singleton'
require 'monitor'
require 'optparse'
require 'ostruct'

require 'rake/ext/module'
require 'rake/ext/string'
require 'rake/ext/time'

require 'rake/win32'

require 'rake/linked_list'
require 'rake/cpu_counter'
require 'rake/scope'
require 'rake/task_argument_error'
require 'rake/rule_recursion_overflow_error'
require 'rake/rake_module'
require 'rake/trace_output'
require 'rake/pseudo_status'
require 'rake/task_arguments'
require 'rake/invocation_chain'
require 'rake/task'
require 'rake/file_task'
require 'rake/file_creation_task'
require 'rake/multi_task'
require 'rake/dsl_definition'
require 'rake/file_utils_ext'
require 'rake/file_list'
require 'rake/default_loader'
require 'rake/early_time'
require 'rake/late_time'
require 'rake/name_space'
require 'rake/task_manager'
require 'rake/application'
require 'rake/backtrace'
```

What is wrong with this approach?

## 1. It doesn't reveal intention

Why is `optparse` being required here? It isn't some wide-purpose gem which many files will likely use. It's actually quite the opposite; `optparse` is used for parsing options from the command-line, which will be done once and only once in the code. If we look at [bin/rake](https://github.com/ruby/rake/blob/8cc7349ffbdf97345e5da15e1a05058c6dbcefec/bin/rake), it calls `Rake.applicaton.run`, and by grepping we find out that [rake/application.rb](https://github.com/ruby/rake/blob/8cc7349ffbdf97345e5da15e1a05058c6dbcefec/lib/rake/application.rb) is the only file which uses `optparse`.

If each file requires only what it needs, then we have a nice overview of each file's dependencies. Now, it can happen that multiple files require the same library. And that's perfectly ok. Ruby will require each library only once, so the other `require`s just won't do anything. No memory worries :wink:

## 2. It hides the important parts of the library

When we look at this file, it is difficult to tell which are the main components Rake is made of. I don't think that "linked_list", "cpu_error" or "rule_recursion_overflow_error" is something I should immediately know about when reading Rake.

```ruby
require 'rake/linked_list'  # <-------------------
require 'rake/cpu_counter'  # <-------------------
require 'rake/scope'
require 'rake/task_argument_error'
require 'rake/rule_recursion_overflow_error' # <--
require 'rake/rake_module'
require 'rake/trace_output'  # <------------------
require 'rake/pseudo_status'  # <-----------------
require 'rake/task_arguments'
require 'rake/invocation_chain'
require 'rake/task'
require 'rake/file_task'
require 'rake/file_creation_task'
require 'rake/multi_task'
require 'rake/dsl_definition'
require 'rake/file_utils_ext' # <-----------------
require 'rake/file_list'
require 'rake/default_loader'
require 'rake/early_time' # <---------------------
require 'rake/late_time'  # <---------------------
require 'rake/name_space'
require 'rake/task_manager'
require 'rake/application'
require 'rake/backtrace'
```

Requiring everything at the top level also encourages a flat structure of the gem. The main file is suddenly responsible for everything, instead letting its main parts require what they need. Then it's easier to realize which classes belong in which namespaces (directories), and structure becomes more clear.

## 3. It hides dependencies of individual classes

If files don't require their own dependencies, it's more difficult to get a design feedback. If each file would require its own dependencies, we could identify which classes have potentially high coupling by looking at the number of their dependencies.

Furthermore, if each class has its dependencies listed on the top of the file, it's easier to understand its code. For example, in the implementation of that class I see a call to `#shellescape`, without context I wouldn't know which library it could belong to. However, if I see `require "shellwords"` at the top of the file, I would most likely try looking in there, where I would find the wanted method.

```ruby
require "shellwords"

# ...
command = "ls #{File.expand_path(__dir__)}"
command.shellescape
# ...
```

## 4. Code is still loaded after it is no longer used

Why are `ostruct`, `monitor` and `singleton` being required here as well? These are all implementation details of Rake's internal classes. Now, if these internal classes by any chance get refactored, and stop needing one of these dependencies, who will remember to remove these `require` statements? Any code that gets loaded when it isn't used is harmful, because it adds to the load time of the gem (and memory).

There are some cases where something is being used in almost every file, and remembering to require it in every file would be tedious, in which case it makes perfect sense to require it in the top level. But seriously, how often do you use `singleton`?

## Solution

What if instead lib/rake.rb looked like this?

```ruby
# lib/rake.rb (improved)

require "rake/application"
require "rake/task"
require "rake/win32"

module Rake
  class << self
    def application
      @application ||= Rake::Application.new
    end

    def application=(app)
      @application = app
    end

    def original_dir
      application.original_dir
    end

    def load_rakefile(path)
      load(path)
    end

    def add_rakelib(*files)
      application.options.rakelib ||= []
      files.each do |file|
        application.options.rakelib << file
      end
    end
  end
end
```

I think this looks *much* nicer. We see that the two main parts of Rake are the **application** (the CLI runner) and the **tasks**. We also see that Rake maintains Windows compatibility. Lastly, by inlining [rake/rake_module.rb](https://github.com/ruby/rake/blob/8cc7349ffbdf97345e5da15e1a05058c6dbcefec/lib/rake/rake_module.rb) like this, we also immediately see the main entry point to Rake, which is useful if we're developing a 3rd-party gem which integrates with Rake.

## Conclusion

If each file only requires the dependencies it needs, the code is easier to read and maintain. Every library can list the *main* components of the libary in its primary file, and then each component in turn can require its own dependencies. This way we get a nice logical tree structure which we can easily follow. Try applying it to your code, and you will start to understand your code better.
