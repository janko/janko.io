---
title: "Rodauth: A Refreshing Take on Authentication in Ruby"
tags: ruby rails orm postgresql database activerecord authentication
---

If you're working with Rails, chances are your authentication layer is
implemented using one of the popular authentication frameworks – [Devise],
[Sorcery], [Clearance], or [Authlogic] – just to name a few. These libraries
helped significantly with making Rails an even more productive web framework to
work in.

One shared characteristic of these authentication frameworks is that they're
all built on top of Rails. This means that they integrate into the existing
Rails components (models, controllers, routes), and that they generally try to
follow The Rails Way of doing things.

However, having had a fair share of experience with the Ruby ecosystem outside
of Rails' [default menu][omakase], I've come to learn that taking the effort to
make your library's implementation **decoupled from Rails** can provide
significant advantages:

* breaking away from Rails gives you space to come up with better design
* your library can now be used with other Ruby web frameworks too
* supporting new Rails versions becomes easier

For a long time, if you wanted to implement authentication outside of Rails,
the go-to choice has been [Warden]. Warden is a Rack-based library that
provides a mechanism for authentication that supports having multiple
strategies. However, the problem is that Warden doesn't actually *do* anything
by itself. You still need to implement login, remembering, registration,
account verification, password reset and other functionality yourself (which is
what Devise does), and I'd argue *this* is actually the hard part :pensive:

## Introducing Rodauth

However, for some time now we've had a better solution. Jeremy Evans,
the author of numerous Ruby libraries, most popular of which are [Roda] and
[Sequel], has been developing a new full-featured authentication framework for
the past 5 years, called **[Rodauth]**. Recently I've finally had the
opportunity to integrate Rodauth into a Rails app at work, and I can safely say
that its tagline – "Ruby's most advanced authentication framework" – is in no
way exaggerated :ok_hand:

When I was evaluating it for the first time, what stood out for me is that, in
contrast to other Rails-based authentication frameworks, Rodauth is implemented
on top of Roda and Sequel. This can throw some people off at first; I too
thought it meant it cannot be used with Rails. But this [turns out not to be
the case][middleware].

The integration did still require a non-trivial amount of Rails glue, which
I've extracted into the **[rodauth-rails]** gem. This includes generators,
controller & view integration, mailer support, CSRF & flash integration, HMAC
security and more. I've also extracted the [sequel-activerecord_connection]
gem, which makes Sequel reuse Active Record's database connection (and which
rodauth-rails automatically configures). All this should make Rodauth easy
enough to get started with in Rails :muscle:

## Encapsulating your authentication logic

Most Rails-based authentication frameworks mix the authentication behaviour
directly into the MVC layer. While this approach keeps things close to Rails,
it also has several downsides:

* authentication logic is spread out across multiple application layers
* models and controllers gain a lot of additional responsibility
* risk of naming clashes limits refactoring freedom

With Rodauth, all authentication behaviour is encapsulated in a special
`Rodauth::Auth` object, which is created inside a Roda middleware and has
access to the request context. We use it to route requests to Rodauth endpoints,
and also to perform any additional authentication actions before the request is
handed over to the main app. This approach allows us to keep the majority (or
even all) of our authentication logic contained in the same file.

Here is an example Rodauth definition that enables several features and
overrides a some default settings:

```rb
class RodauthApp < Roda
  # allow this Roda app to be used as Rack middleware
  plugin :middleware
  # define your Rodauth configuration
  plugin :rodauth do
    # load authentication features you need
    enable :login, :logout, :create_account, :verify_account, :reset_password
    # change default settings
    password_minimum_lenth 8
    account_password_hash_column :password_hash
    login_return_to_requested_location? true
    reset_password_autologin? true
    logout_redirect "/"
    # ...
  end
  # called for each request before it reaches your main app
  route do |r|
    # handle Rodauth paths (/login, /create-account, /reset-password, ...)
    r.rodauth
    # require authentication for /dashboard* routes
    if r.path.start_with?("/dashboard")
      rodauth.require_authentication
    end
  end
end
```

When we add the above Roda app to our middleware stack, the `route` block will
be called for each request before it reaches our main app, yielding the request
object. The `r.rodauth` call will handle any Rodauth routes, while
`rodauth.require_authentication` will redirect to login page if the session is
not authenticated. When the end of the routing block is reached, the request
proceeds onto our main app.

If we're using Rails with rodauth-rails, the Rodauth instance will remain
available in our controllers and views as well, so we can do things like
require authentication at the controller level:

```rb
class PostsController < ApplicationController
  before_action -> { rodauth.require_authentication }
  # ...
end
```

or render links in our views:

```erb
<% if rodauth.authenticated? %>
  <%= link_to "Sign out", rodauth.logout_path, method: :post %>
<% else %>
  <%= link_to "Sign in", rodauth.login_path %>
  <%= link_to "Sign up", rodauth.create_account_path %>
<% end %>
```

There are many more useful authentication methods defined on the Rodauth
instance that give us additional flexibility and introspection:

```rb
rodauth.auhenticated_by                   # e.g. ["password", "otp"]
rodauth.session_value                     # returns the account id from the session
rodauth.account_from_login("foo@bar.com") # retrieves account from given email address
rodauth.password_match?("secret")         # whether given password matches password of current account
rodauth.login_session("password")         # logs the retrieved account in
rodauth.logout                            # logs the session out
# ...
```

## Feature maturity

Rodauth has all of the essential features you already know from other
authentication frameworks:

* [login]/[logout] and [remember] (including [HTTP Basic authentication][http basic auth])
* [create account] with [email verification][verify account] (and a [grace period][verify account grace period])
* [reset password] and [change password]
* [change email][change login] with [email verification][verify login change]
* [lockout] and [close account]

You'll also find most industrial standard security features the
[devise-security] extension provides:

* [password expiration] and [disallowing password reuse][disallow password reuse]
* [password complexity checks][password complexity] and [disallowing common passwords][disallow common passwords]
* [account expiration] and [single session]

as well as many other useful features:

* [email authentication] (aka "passwordless")
* [password confirmation dialog][confirm password] (with a [grace period][password grace period])
* [audit logging] (for every action)
* ...

### Multifactor authentication

In addition to the features above, Rodauth also provides **multifactor
authentication** functionality out-of-the-box, supporting multiple MFA methods
([TOTP], [SMS codes], [recovery codes], and [WebAuthn]).

Here is an example setup that allows a user to enable TOTP authentication for
their account, along with a backup SMS number and recovery codes (provided we
created the necessary database tables):

```rb
class RodauthApp < Roda
  plugin :rodauth do
    enable :login, :create_account, :otp, :sms_codes, :recovery_codes
    # use Twilio to send SMS messages
    sms_send do |phone, message|
      twilio = Twilio::Rest::Client.new("<ACCOUNT_SID>", "<AUTH_TOKEN>")
      twilio.messages.create(body: message, to: phone, from: "<APP_PHONE_NUMBER>")
    end
  end
end
```

We can now generate links to Rodauth's built-in MFA manage page, which will
guide the user to set up MFA for their account.

```erb
<!-- somewhere under account settings: -->
<% if rodauth.uses_two_factor_authentication? %>
  <%= link_to "Manage MFA", rodauth.two_factor_manage_path %>
  <%= link_to "Disable MFA", rodauth.two_factor_disable_path %>
<% else %>
  <%= link_to "Setup MFA", rodauth.two_factor_manage_path %>
<% end %>
```

The advantage of having multifactor authentication built in (as opposed to
having an [external gem][devise-two-factor]) is that Rodauth's design is now
adjusted to accommodate this functionality. It also means this feature will
continue being compatible with new Rodauth releases.

### JWT

Another cool feature of Rodauth is its built-in support for [JWT] ([JSON Web
Tokens]), which provides token-based JSON API access for each authentication
feature. Here is how we can configure the JWT feature:

```rb
class RodauthApp < Roda
  plugin :rodauth, json: :only do # 1. enable Roda's JSON support and only allow JSON access
    enable :login, :create_account, :change_password, :close_account, :jwt # 2. load JWT feature
    jwt_secret "abc123" # 3. set secret for the JWT feature
    require_login_confirmation? false
    require_password_confirmation? false
  end
end
```

Now we can trigger Rodauth actions via a JSON requests, using the
`Authorization` header for authentication. Here is an example flow using
[http.rb]:

```rb
http = HTTP.accept(:json)
# 1) create an account
response = http.post("https://myapp.com/create-account", json: { login: "foo@example.com", password: "secret" })
token = response.headers["Authorization"]
# 2) change the password
response = http.auth(token).post("https://myapp.com/change-password", json: { password: "secret", "new-password": "new secret" })
# 3) login with the new password
response = http.post("https://myapp.com/login", json: { login: "foo@example.com", password: "new secret" })
token = response.headers["Authorization"]
# 4) close the account
http.auth(token).post("https://myapp.com/close-account", json: { password: "new secret" })
# 5) try to login again
response = http.post("https://myapp.com/login", json: { login: "foo@example.com", password: "new secret" })
response.status.to_s # => "401 Unauthorized"
```

JSON API support in other authenication frameworks has always been everything
*but* standardized; for Devise there is [Devise Token Auth], [Devise::JWT], and
[Simple Token Authentication], while Sorcery currently has [multiple open pull
requests][sorcery pulls] adding JWT support.

## Uniform configuration DSL

If we look at how Devise is customized, we'll notice that there are several
different layers on which we can tweak authentication behaviour: global
settings, model settings, controller settings, and routing settings. Some
settings can be configured dynamically (based on either model or controller
instance state), while other can only be configured statically. Some
before/after hooks are trigged on the model level, other require overriding
controller actions. This is not very consistent :stuck_out_tongue:

Rodauth is the opposite. It provides a uniform configuration DSL that allows
overriding virtually any default value or behaviour in the same way: either
by providing a static value or a dynamic block. The given block is always
evaluated in the context of the `Rodauth::Auth` instance (where all Rodauth
methods are defined), and you can call `super` to get the default behaviour.

```rb
class RodauthApp < Roda
  plugin :rodauth do
    # each feature adds its own set of configuration methods
    enable :login, :logout, :remember,
      :create_account, :verify_account, :verify_account_grace_period,
      :reset_password, :change_password, :change_login, :verify_login_change

    password_confirm_param "confirm_password"
    create_account_route "register"
    accounts_table :user_accounts

    login_valid_email? { |login| TrueMail.valid?(login) }
    no_matching_login_message "account with this email doesn't exist"
    password_minimum_length { AppConfig.get(:min_password_length) }

    login_return_to_requested_location? true
    reset_password_autologin? true
    verify_account_grace_period 3.days

    login_notice_flash "You have been successfully signed in"
    reset_password_error_flash "Something went wrong resetting your password"
    login_redirect "/dashboard"
    verify_account_redirect { login_redirect }
  end
end
```

### Hooks

Rodauth consistently provides hooks around virtually any action, which we can
override in our configuration block. We can do something before/after specific
operations:

```rb
after_login           { remember_login }
before_create_account { throw_error("company", "must be present") if param("company").empty? }
after_login_failure   { LoginAttempts.increment(account[:email]) }
```

before specific routes:

```rb
before_change_login_route   { require_password_authentication }
before_create_account_route { redirect "/register" if param("type").empty? }
```

or before each Rodauth route:

```rb
before_rodauth { AuthLogger.call(request) }
```

## Enhanced security

### Tokens

### Password hash access

## Design highlights

### Layered authentication features

### Database table per feature

## Closing words

## Further reading

* Rodauth feature documentation
* Rodauth guides (short documents covering common scenarios)
* Rodauth internals

[Devise]: https://github.com/heartcombo/devise
[Sorcery]: https://github.com/Sorcery/sorcery
[Clearance]: https://github.com/thoughtbot/clearance
[Authlogic]: https://github.com/binarylogic/authlogic
[omakase]: https://rubyonrails.org/doctrine/#omakase
[Rodauth]: https://github.com/jeremyevans/rodauth/
[Warden]: https://github.com/wardencommunity/warden
[Roda]: https://github.com/jeremyevans/roda
[Sequel]: https://github.com/jeremyevans/sequel
[middleware]: http://rodauth.jeremyevans.net/rdoc/files/README_rdoc.html#label-With+Other+Web+Frameworks
[rodauth-rails]: https://github.com/janko/rodauth-rails
[sequel-activerecord_connection]: https://github.com/janko/sequel-activerecord_connection
[roda introduction]: https://janko.io/introduction-to-roda/
[login]: https://github.com/jeremyevans/rodauth/blob/master/lib/rodauth/features/login.rb
[logout]: https://github.com/jeremyevans/rodauth/blob/master/lib/rodauth/features/logout.rb
[http basic auth]: https://github.com/jeremyevans/rodauth/blob/master/lib/rodauth/features/http_basic_auth.rb
[create account]: https://github.com/jeremyevans/rodauth/blob/master/lib/rodauth/features/create_account.rb
[verify account]: https://github.com/jeremyevans/rodauth/blob/master/lib/rodauth/features/verify_account.rb
[verify account grace period]: https://github.com/jeremyevans/rodauth/blob/master/lib/rodauth/features/verify_account_grace_period.rb
[reset password]: https://github.com/jeremyevans/rodauth/blob/master/lib/rodauth/features/reset_password.rb
[change password]: https://github.com/jeremyevans/rodauth/blob/master/lib/rodauth/features/change_password.rb
[change login]: https://github.com/jeremyevans/rodauth/blob/master/lib/rodauth/features/change_login.rb
[verify login change]: https://github.com/jeremyevans/rodauth/blob/master/lib/rodauth/features/verify_login_change.rb
[remember]: https://github.com/jeremyevans/rodauth/blob/master/lib/rodauth/features/remember.rb
[lockout]: https://github.com/jeremyevans/rodauth/blob/master/lib/rodauth/features/lockout.rb
[close account]: https://github.com/jeremyevans/rodauth/blob/master/lib/rodauth/features/close_account.rb
[devise-security]: https://github.com/devise-security/devise-security
[account expiration]: http://rodauth.jeremyevans.net/rdoc/files/doc/account_expiration_rdoc.html
[password expiration]: http://rodauth.jeremyevans.net/rdoc/files/doc/password_expiration_rdoc.html
[disallow password reuse]: http://rodauth.jeremyevans.net/rdoc/files/doc/disallow_password_reuse_rdoc.html
[password complexity]: http://rodauth.jeremyevans.net/rdoc/files/doc/password_complexity_rdoc.html
[disallow common passwords]: http://rodauth.jeremyevans.net/rdoc/files/doc/disallow_common_passwords_rdoc.html
[single session]: http://rodauth.jeremyevans.net/rdoc/files/doc/single_session_rdoc.html
[email authentication]: http://rodauth.jeremyevans.net/rdoc/files/doc/email_auth_rdoc.html
[confirm password]: http://rodauth.jeremyevans.net/rdoc/files/doc/confirm_password_rdoc.html
[password grace period]: http://rodauth.jeremyevans.net/rdoc/files/doc/password_grace_period_rdoc.html
[audit logging]: http://rodauth.jeremyevans.net/rdoc/files/doc/audit_logging_rdoc.html
[TOTP]: http://rodauth.jeremyevans.net/rdoc/files/doc/otp_rdoc.html
[SMS codes]: http://rodauth.jeremyevans.net/rdoc/files/doc/sms_codes_rdoc.html
[recovery codes]: http://rodauth.jeremyevans.net/rdoc/files/doc/recovery_codes_rdoc.html
[WebAuthn]: http://rodauth.jeremyevans.net/rdoc/files/doc/webauthn_rdoc.html
[Bootstrap]: https://getbootstrap.com/
[devise-two-factor]: https://github.com/tinfoil/devise-two-factor
[JWT]: http://rodauth.jeremyevans.net/rdoc/files/doc/jwt_rdoc.html
[JSON Web Tokens]: https://jwt.io/
[JWT refresh tokens]: http://rodauth.jeremyevans.net/rdoc/files/doc/jwt_refresh_rdoc.html
[CORS]: http://rodauth.jeremyevans.net/rdoc/files/doc/jwt_cors_rdoc.html
[Devise Token Auth]: https://github.com/lynndylanhurley/devise_token_auth
[Devise::JWT]: https://github.com/waiting-for-dev/devise-jwt
[Simple Token Authentication]: https://github.com/gonzalo-bulnes/simple_token_authentication
[sorcery pulls]: https://github.com/sorcery/sorcery/pulls?q=jwt+is%3Apr+in%3Atitle+
[http.rb]: https://github.com/httprb/http/
[database tables]: http://rodauth.jeremyevans.net/rdoc/files/README_rdoc.html#label-Creating+tables
