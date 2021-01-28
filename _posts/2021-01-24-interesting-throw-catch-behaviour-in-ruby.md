---
title: Interesting throw/catch behaviour in Ruby
tags: til
---

When I was working on integrating [Rodauth] with OmniAuth authentication, I
noticed an error warning after upgrading to Rails 6.1, when Rodauth was
redirecting inside a Rails controller action:

```rb
class RodauthController < ApplicationController
  def omniauth
    # ...
    rodauth.login("omniauth") # logs the session in and redirects
  end
end
```
```
Could not log "process_action.action_controller" event.
/path/to/actionpack-6.1.1/lib/action_controller/log_subscriber.rb:26:in `block in process_action': undefined method `first' for nil:NilClass (NoMethodError)
```

Since I want the integration between Rodauth and Rails to be as smooth as
possible, I decided to investigate.

## Diving in

Let's see the `ActionController::LogSubscriber` source code where the error
happens:

```rb
# lib/action_controller/log_subscriber.rb
module ActionController
  class LogSubscriber < ActiveSupport::LogSubscriber
    # ...
    def process_action(event)
      # ...
        status = payload[:status]

        if status.nil? && (exception_class_name = payload[:exception].first) # <==== the exception happens here
          status = ActionDispatch::ExceptionWrapper.status_code_for_exception(exception_class_name)
        end
      # ...
    end
    # ...
  end
end
```

We can see that the issue happens because `:exception` data is missing from the
instrumentation event payload. Let's look at
`ActionController::Instrumentation` next, which is in charge of instrumenting
controller actions:

```rb
# lib/action_controller/metal/instrumentation.rb
class ActionController
  module Instrumentation
    def process_action(*)
      # ...
      ActiveSupport::Notifications.instrument("process_action.action_controller", raw_payload) do |payload|
        result = super # <=== this calls our controller action
        payload[:response] = response
        payload[:status]   = response.status
        # ...
      end
    end
  end
end
```

We can see that, if our controller action raises an exception, the `:status`
data will never be set. This ties to the `status.nil?` check we've seen in the
`ActionController::LogSubscriber`.

The remaining part is to find where `:exception` is being set. Knowing that
instrumentation is implemented in Active Support, I quickly found
`ActiveSupport::Notifications::Instrumenter`:

```rb
# lib/active_support/notifications/instrumenter.rb
module ActiveSupport
  module Notifications
    class Instrumenter
      # ...
      def instrument(name, payload = {})
        # ...
        begin
          yield payload if block_given?
        rescue Exception => e
          payload[:exception] = [e.class.name, e.message] # <==== the exception is set here
          payload[:exception_object] = e
          raise e
        ensure
          finish_with_state listeners_state, name, payload
        end
      end
    end
  end
end
```

## The problem

When Rodauth redirects, what is actually doing is throwing `:halt` with the
rack response. This is how Roda implements redirection, and it's common practice
in non-Rails web frameworks (Sinatra and Cuba do it too). In our case, throwing
exits from controller action and is caught by the Roda middleware.

Does throwing act the same way as raising an exception does? Initially it
would appear so:

```rb
begin
  throw :halt
rescue Exception => exception
  puts "rescue: #{exception.inspect}"
  raise
ensure
  puts "ensure"
end
```
```
rescue: #<UncaughtThrowError: uncaught throw :halt>
ensure
~> uncaught throw :halt (UncaughtThrowError)
```

This makes sense to me, because uncaught throw *is* an exception. But then why
wasn't the `rescue` block that was supposed to set the `:exception` in the
event payload being executed?

The picture starts getting clearer when we wrap the code with a `catch`
block:

```rb
catch(:halt) do
  begin
    throw :halt
  rescue Exception => exception
    puts "rescue: #{exception.inspect}"
    raise
  ensure
    puts "ensure"
  end
end
```
```
ensure
```

We see that in this case the `rescue` block isn't being executed, and this is
precisely our scenario. This actually makes sense when you think about it,
because a `throw` with a matching `catch` is not anything erroneous, it's just
a way to do an early return.

## The solution

Now we know where the issue is, which is that Rails just wasn't correctly
handling a `throw`/`catch` scenario when processing controller actions. [Fixing
it][pr] was the easy part.

`throw`/`catch` is probably something you'll rarely use, but it does have its
use cases. I hope this article taught you a bit more about this lesser known
Ruby feature.

[Rodauth]: https://github.com/jeremyevans/rodauth
[pr]: https://github.com/rails/rails/pull/41223
