---
title: "Rodauth: A Refreshing Take on Authentication in Ruby"
tags: ruby rails orm postgresql database activerecord authentication
---

If you're working with Rails, chances are your authentication layer is
implemented using one of the popular authentication frameworks – [Devise],
[Sorcery], [Clearance], or [Authlogic]. These libraries provide complete
authentication and account management functionality for Rails, allowing you to
spend more time on the actual business logic of your product.

One characteristic the above authentication frameworks have in common is that
they're all built on top of Rails. This means that they plug into the existing
Rails components (models, controllers, routes), and generally try to follow
"The Rails Way" of doing things.

However, when building on top of Rails, it can also be easy for your library to
inherit some of Rails' *anti-patterns*, such as overburdening models and
controllers with [additional responsibilities][srp] and overusing Active Record
callbacks. Having had my fair share of experience with the Ruby ecosystem
outside of Rails' [default menu][omakase], I've come to learn that taking the
effort to make your library's implementation **decoupled from Rails** can
provide significant advantages:

* breaking away from Rails gives you mental space to design your library better
* your library can now be used with other Ruby web frameworks too :innocent:
* supporting new Rails versions becomes easier

If one wanted to implement authentication in another Ruby web framework, the
frequently recommended solution seemed to be [Warden]. Warden is a Rack-based
library that provides a mechanism for authentication, with support for multiple
strategies. However, the problem is that Warden doesn't actually *do* anything
by itself. You still need to implement login, remembering, registration,
account verification, password reset and other functionality yourself (which is
what Devise does), and I'd argue *this* is actually the hard part :sweat:

## Enter Rodauth

We've actually had a better solution for some time now, but it just hasn't
received enough attention. Jeremy Evans – a [Ruby Hero][rubyheroes2015], a Ruby
committer, and an author of numerous Ruby libraries (most popular of which is
[Sequel] and [Roda]) – has been developing a new full-featured authentication
framework for the past several years, called **[Rodauth]**. Recently I've
finally had the opportunity to integrate Rodauth into a Rails app at work, and
I can safely say that its tagline – *"Ruby's <ins>most advanced</ins>
authentication framework"* – is in no way exaggerated :ok_hand:

One of the first things you'll notice is that, in constrast to other
authentication frameworks which are built on top of Rails and Active Record,
Rodauth is implemented using Roda and Sequel. As a big fan of both libraries,
for me personally this was exciting, but at the same time I was worried this
meant Rodauth cannot be used with Rails. However, it turns out Rodauth can in
fact be used with any Rack-based web framework, including Rails.

Integrating Rodauth properly into Rails definitely wasn't trivial, but once all
the kinks had been worked out, I extracted the glue code into
**[rodauth-rails]**. It comes with generators, controller & view integration,
mailer support, CSRF & flash integration, HMAC security and more. Additionally,
to make Sequel coexist better with Active Record, I've created the
[sequel-activerecord_connection] gem, which enables Sequel to reuse Active
Record's database connection. All this should make Rodauth as easy to get
started with as its Rails-based counterparts :muscle:

With its recent [2.0 release], it's time to finally take a proper look into
Rodauth and see what makes it so special :sparkles:

## Encapsulated authentication logic

As we've touched on before, what characterizes most Rails-based authentication
frameworks is that they implement their authentication behaviour directly on
the MVC layer. While this approach keeps things close to Rails, it also shoves
additional responsibilities into already-heavy Rails components, and generally
causes authentication logic to be spread out across multiple application
layers.

With Rodauth, all authentication behaviour is encapsulated in a special
`Rodauth::Auth` object, which is created inside a Roda middleware and has
access to the request context. It handles everything from routing requests to
Rodauth endpoints to performing authentication-related commands and queries.
It's also configured as a Roda plugin and can be used in Roda's routing
block to perform any actions before the request reaches the main app. This
design enables us to keep our authentication logic contained in a single file.

```rb
class RodauthMiddleware < Roda
  # define your Rodauth configuration
  plugin :rodauth do
    # load authentication features you need
    enable :login, :logout, :create_account, :verify_account, :reset_password
    # change default settings
    password_minimum_lenth 8
    login_return_to_requested_location? true
    reset_password_autologin? true
    logout_redirect "/"
    # ...
  end
  # handles requests before they reach the main app
  route do |r|
    # handle Rodauth paths (/login, /create-account, /reset-password, ...)
    r.rodauth
    # require authentication for certain routes
    if r.path.start_with?("/dashboard")
      rodauth.require_authentication
    end
  end
end
```

When we add the above Roda app to our middleware stack, the `route` block will
be called for each request before it reaches our main app, yielding the request
object. The `r.rodauth` call will handle any Rodauth routes, while
`rodauth.require_authentication` will redirect to the login page if the session
is not authenticated. When the end of the routing block is reached, the request
proceeds onto our main app.

If you're using Rails with rodauth-rails, the Rodauth instance will remain
available in your controllers and views as well, so you can do things like
require authentication at the controller level if you prefer to:

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
rodauth.session_value                     # returns account id from the session
rodauth.account_from_login("foo@bar.com") # retrieves account with given email address
rodauth.password_match?("secret")         # returns whether given password matches current account's password
rodauth.login("password")                 # logs the account in and redirects with a notice flash
rodauth.logout                            # logs the session out
# ...
```

## Feature maturity

Rodauth has all of the essential features you already know from other
authentication frameworks:

* [login]/[logout] and [remember]
* [create account] with [email verification][verify account] (and a [grace period][verify account grace period])
* [reset password] and [change password]
* [change email][change login] with [email verification][verify login change]
* [lockout] and [close account]

You'll also find most industry-standard security features the [devise-security]
extension provides:

* [password expiration] and [disallowing password reuse][disallow password reuse]
* [password complexity checks][password complexity] and [disallowing common passwords][disallow common passwords]
* [account expiration] and [single session]

There are many other useful features as well:

* [HTTP Basic authentication][http basic auth]
* [email authentication] (aka "passwordless")
* [password confirmation dialog][confirm password] (with a [grace period][password grace period])
* [audit logging] (for every action)
* ...

### Multifactor authentication

In addition to the features above, Rodauth also provides **multifactor
authentication** functionality out-of-the-box, supporting multiple MFA methods
([TOTP], [SMS codes], [recovery codes], and [WebAuthn]).

Here is an example setup that allows a user to enable TOTP verification for
their account, along with a backup SMS number and recovery codes.

```rb
class RodauthApp < Roda
  plugin :rodauth do
    enable :otp, :sms_codes, :recovery_codes, ...
    # use Twilio to send SMS messages
    sms_send do |phone, message|
      twilio = Twilio::Rest::Client.new("<ACCOUNT_SID>", "<AUTH_TOKEN>")
      twilio.messages.create(body: message, to: phone, from: "<APP_PHONE_NUMBER>")
    end
  end
end
```

Given we've created the necessary [database tables], we can now generate links
to Rodauth's MFA pages, which provide a basic interface for users to manage MFA
for their account.

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
having an [external gem][devise-two-factor]) is that fact that Rodauth's design
has been adjusted to accommodate this functionality. It also means this feature
will remain compatible with new Rodauth releases.

### JSON API

Another cool feature of Rodauth is its built-in support for [JWT] (short for
[JSON Web Tokens]), which provides token-based JSON API access for each
authentication feature. Here is how we can configure the JWT feature:

```rb
class RodauthApp < Roda
  plugin :rodauth, json: :only do # 1) enable Roda's JSON support and only allow JSON access
    enable :login, :create_account, :change_password, :close_account, :jwt # 2) load JWT feature
    jwt_secret "abc123" # 3) set secret for the JWT feature
    require_login_confirmation? false
    require_password_confirmation? false
  end
end
```

With this we can now trigger Rodauth actions via a JSON requests, using the
`Authorization` header for authentication. Here is an example flow using
[http.rb]:

```rb
# 1) create an account
response = HTTP.post("https://myapp.com/create-account", json: { login: "foo@example.com", password: "secret" })
token = response.headers["Authorization"]
# 2) change the password
response = HTTP.auth(token).post("https://myapp.com/change-password", json: { password: "secret", "new-password": "new secret" })
# 3) login with the new password
response = HTTP.post("https://myapp.com/login", json: { login: "foo@example.com", password: "new secret" })
token = response.headers["Authorization"]
# 4) close the account
http.auth(token).post("https://myapp.com/close-account", json: { password: "new secret" })
# 5) try to login again
response = HTTP.post("https://myapp.com/login", json: { login: "foo@example.com", password: "new secret" })
response.status.to_s # => "401 Unauthorized"
```

Other authentication frameworks haven't yet standardized JSON API support:

* Devise has multiple solutions ([DeviseTokenAuth], [Devise::JWT],
  [SimpleTokenAuthentication])
* Sorcery currently has a few unmerged pull requests ([#239][sorcery #239],
  [#167][sorcery #167], [#70][sorcery #70])
* Clearance doesn't currently support JSON ([comment][clearance json])

## Uniform configuration DSL

If we look at how Devise is customized, we'll notice there are several
different layers on which we can configure authentication behaviour: global
settings, model settings, controller settings, and routing settings. Some
of these settings can be configured dynamically (based on either model or
controller state), while other can only be configured statically. And some
before/after hooks are triggered on the model level, while for others you need
to override controller actions. This is pretty inconsistent :stuck_out_tongue:

In contrast, Rodauth provides a uniform configuration DSL that allows changing
virtually any authentication behaviour, which is all defined on the
`Rodauth::Auth` class. You can override a configuration method either by
providing a static value, or by passing a dynamic block that gets evaluated in
context of a `Rodauth::Auth` instance (and you can call `super` to get original
behaviour).

```rb
class RodauthApp < Roda
  plugin :rodauth do
    # each feature adds its own set of configuration methods
    enable :login, :create_account, :verify_account_grace_period, :reset_password

    # examples of static values:
    login_redirect "/dashboard"        # redirect to /dashboard after logging in
    verify_account_grace_period 3.days # allow unverified access for 3 days after registration
    reset_password_autologin? true     # automatically log the user in after password reset

    # examples of dynamic blocks:
    password_minimum_length { MyConfig.get(:min_password_length) } # change minimum allowed password length
    login_valid_email? { |login| TrueMail.valid?(login) }          # override email validation logic
    verify_account_redirect { login_redirect }                     # after account verification redirect to wherever login redirects to
  end
end
```

Internaly, Rodauth also provides a [DSL for writing new features][rodauth
feature dsl], which streamlines adding new configuration methods and encourages
making the feature behaviour as flexible as possible.

### Hooks

Rodauth consistently provides hooks for virtually any action, which we can
override inside our configuration block. We can do something before/after
specific operations:

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

When I would talk to people about Rodauth, one common concern would be whether
it's secure enough, given that alternatives such as Devise are more
widely-used. While I'm not qualified enough to provide a direct answer, there
are multiple indications that Jeremy takes Rodauth's security very seriously:

* Rodauth incorporates some [additional security measures][rodauth security]
  not found in other authentication frameworks (we'll talk about these below)
* Jeremy [proactively patches][rodauth clearance tokens] Rodauth when new
  security issues are found in other authentication frameworks
* Jeremy's [talks][jeremy rubyhack2018] showcase some very advanced knowledge
  on web application security

### Tokens

Many authentication features (remembering logins, password reset, account
verification, email change verification etc.) generate random unique tokens as
part of their functionality. Since these tokens often give permissions for
performing sensitive actions, we don't want others having access to them.

When `hmac_secret` is set (rodauth-rails sets it automatically), Rodauth will
sign the tokens sent via email using HMAC, while the raw tokens will be stored
in the database. This will make it so if the tokens in the database are leaked
(e.g. via an SQL injection vulnerability), they will not be usable without also
having access to the HMAC secret.

```rb
hmac_secret "abc123"
```

For better bruteforce protection, Rodauth tokens also include the account id.
This way an attacker can only attempt to bruteforce the token for a single
account at a time, instead of being able to bruteforce tokens for all accounts
at once.

```
<account_id>_<random_token>
```

### Protecting password hashes

When the user creates an account, rather than storing their password as plain
text, we normally hash the password using a hashing function such as [bcrypt]
and store that instead. This helps protect against rainbow table attacks and
brute-force search attacks in case the database is breached.

However, even with bcrypt, if an attacker was able to obtain the password
hashes from the database (e.g. via an SQL injection), they can crack passwords
vastly faster than via an online attack. For one, an online attack is easy to
detect, nd the [lockout] feature

If a database breach *does* happen, however, the obtained password hashes can
still help the attacker crack accounts that use the weakest passwords.

As an additional layer of security

## Other design highlights

### Decoupled authentication features

### Database table per feature

### Linear code over callbacks

## Closing words

* I don't get the need for "Active Authentication"

## Further reading

* [Rodauth documentation]
* [rodauth-rails]
* [Rodauth internals]

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
[DeviseTokenAuth]: https://github.com/lynndylanhurley/devise_token_auth
[Devise::JWT]: https://github.com/waiting-for-dev/devise-jwt
[SimpleTokenAuthentication]: https://github.com/gonzalo-bulnes/simple_token_authentication
[sorcery #239]: https://github.com/Sorcery/sorcery/pull/239
[sorcery #167]: https://github.com/Sorcery/sorcery/pull/167
[sorcery #70]: https://github.com/Sorcery/sorcery/pull/70
[clearance json]: https://github.com/thoughtbot/clearance/issues/896#issuecomment-667257763
[http.rb]: https://github.com/httprb/http/
[database tables]: http://rodauth.jeremyevans.net/rdoc/files/README_rdoc.html#label-Creating+tables
[jeremy rubyhack2018]: http://confreaks.tv/videos/rubyhack2018-ruby-web-application-security-defense-in-depth
[rodauth clearance tokens]: https://github.com/jeremyevans/rodauth/commit/18f26487c798cc5055cd5caf8bcafee1af719e3a
[rodauth security]: https://github.com/jeremyevans/rodauth/#label-Security
[srp]: https://en.wikipedia.org/wiki/Single-responsibility_principle
[bcrypt]: https://en.wikipedia.org/wiki/Bcrypt
[rubyheroes2015]: https://rubyheroes.com/heroes/2015
[2.0 release]: http://rodauth.jeremyevans.net/rdoc/files/doc/release_notes/2_0_0_txt.html
[Rodauth documentation]: http://rodauth.jeremyevans.net/documentation.html
[Rodauth internals]: http://rodauth.jeremyevans.net/rdoc/files/doc/guides/internals_rdoc.html
[rodauth feature dsl]: http://rodauth.jeremyevans.net/rdoc/files/doc/guides/internals_rdoc.html#label-Feature+Creation+Example
