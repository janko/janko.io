---
title: Minimal self-contained example that reproduces the bug
tags: ruby bug report minimal issue
published: false
---

TODO:
  * http://www.jonathanleighton.com/articles/2011/awesome-active-record-bug-reports/
  * https://christoph.luppri.ch/articles/2017/06/26/single-file-rails-applications-for-fun-and-bug-reporting/

If you've ever reported any bugs to open source projects, you've probably
received the following request from its maintainers at some point:

> Please provide a minimal self-contained example that reproduces the bug.

Hmm, that definitely doesn't sound easy. But let's first break down what it
means.

The first and the most important thing in reporting a bug is to provide the
maintainer all the instructions necessary for reproducing the bug. Once the
maintainer was able to reproduce the bug, they will have a much higher chance
of rooting down the issue.

Now, instead of writing instructions in words explaining how to reproduce the
bug, it would be much better to actually write it in code, so that there is no
ambiguity. This code should ideally be written as a self-contained script that
can be run with a simple `ruby bug.rb`.

Finally, this script should contain as little code as possible. Only parts
of code which are necessary for reproducing the bug should stay, all extra code
should be stripped away.

Depending on the nature of the bug and your environment, isolating the issue
might be a difficult thing to do. For example, in your Ruby webapp it might be
difficult to isolate the problem, because you don't know which combination of
your 100 gems is making the bug happen. But think about it, if *you* cannot
isolate the issue – the person who has access to all the code – how do you
expect the maintainer to do it?

Providing a minimal self-contained example that reproduces the bug provides
several benefits:

* it *proves* that the bug in fact does exist
* it gives the maintainer all the code necessary for debugging
* it narrows down possible reasons why the bug could occur

**All of these things greatly increase the chance that your issue will be
solved, and that it will be solved fast.** This means that isolating the issue
is in your interest as well!

## Example

Now, I thought it would be useful to illustrate what exactly I mean, by
creating an imaginary bug report. My goal with this example is to show you the
way of thinking which can be applied whenever you're reporting bugs for any
library.

For the example I will choose reporting an imaginary bug in **ActiveRecord**.
The reason for this particular choice is that reporting a bug for an ORM in this
way will come with some interesting challenges. Also, ActiveRecord is a library
that the vast majority of Ruby developers are already familiar with.

Let's imagine that there is a bug with ActiveRecord's attribute conversion of
boolean values. When a boolean value is submitted through the form via a
checkbox, it will present in the params as `"1"` or `"true"`. Let's assume that
this conversion doesn't work for some reason. This is how a typical user might
report such a bug:

```rb
class AlbumController < ApplicationController
  def create
    album = Album.create(params)
    album.private #=> nil (expected "true")
  end

  private

  def album_params
    params.require(:album).permit(:name, :private)
  end
end
```
```erb
<%= form_for @album do |f| %>
  <%= f.text_field :name %>
  <%= f.check_box :private
<% end %>
```

The problem with this bug report is that, in order for the maintainer to
actually reproduce the bug, they have to create a new app and copy this code,
then run the app and try to reproduce the bug in the browser. However,
ActiveRecord is just an ORM that's independent of a web framework, so there is
actually no reason to drag Rails into your bug report.

Let's improve this bug report by trimming it down to use only ActiveRecord:

```rb
# This is the class of the `params` in the controller
params = ActiveSupport::HashWithIndifferentAccess.new(private: "1")
album = Album.create(params)
album.private #=> nil (expected "true")
```

This is a big improvement, because now our bug report is much simpler. However,
notice that we still cannot execute this code. First let's require ActiveRecord
and ActiveSupport, and define the `Album` model.

```rb
require "active_record"
require "active_support/hash_with_indifferent_access"

# We can define ActiveRecord models inline
class Album < ActiveRecord::Base
end

params = ActiveSupport::HashWithIndifferentAccess.new(private: "1") # class of rails params
album = Album.create(params)
album.private #=> nil (expected "true")
```

We are much closer now. As the final step we need to connect to a database, and
create our schema. If you're a Rails user, you might think that you need a
`config/database.yml` to connect, and migration files to change the schema. But
ActiveRecord can be used directly:

```rb
require "active_record"
require "active_support/hash_with_indifferent_access"

# We connect to the database, and add the table
ActiveRecord::Base.establish_connection(adapter: "sqlite3", database: ":memory:")
ActiveRecord::Base.connection.create_table(:albums) do |t|
  t.string  :name
  t.boolean :private
end

class Album < ActiveRecord::Base
end

params = ActiveSupport::HashWithIndifferentAccess.new(private: "1") # class of rails params
album = Album.create(params)
album.private #=> nil (expected "true")
```

In the above example we are connecting to an in-memory SQLite database. This is
the simplest way because: (a)

[inverse associations]: http://api.rubyonrails.org/classes/ActiveRecord/Associations/ClassMethods.html#module-ActiveRecord::Associations::ClassMethods-label-Setting+Inverses
