---
title: What It Took to Build a Rails Integration for Rodauth
tags: rodauth
---

When [Rodauth] came out, I was excited to finally have a full-featured authentication framework that *wasn't* tied to Rails, given that existing solutions required either Rails (Devise, Sorcery), or at least Active Record (Authlogic). Even though I mainly develop in Rails, I want other Ruby web frameworks to be viable alternatives, so I'm naturally drawn to generic solutions that everyone can use.

Even though Rodauth is built on top of [Roda] and [Sequel], it can work as a Rack middleware in any Ruby web framework. In the beginning, there was a [demo app][old demo] showing how Rodauth can be used in Rails, which leveraged the (now discontinued) [roda-rails] gem. However, the integration felt fairly raw, and definitely lacked the ergonomics Rails developers are used to.

Rodauth has a [vast feature set], but if it was going to compete with other authentication solutions, it needed to match their level of convenience in context of Rails. That meant deeply integrating into the Rails framework, having clear drawers where code goes, and defaults that are easy to get started with. At the start of 2020, I set on a mission to make using Rodauth in Rails easy.

## Initial spike

I first created a [demo Rails app][new demo], and started setting up Rodauth there. In the [early][iteration 1] [iterations][iteration 2], I managed to hook up view rendering, flash messages, CSRF protection, and email delivery to use Rails instead of Roda, with significantly less code compared to roda-rails. I also managed to make Rodauth code reloadable by inserting a proxy Rack middleware that just calls the Roda app.

```rb
# app/misc/rodauth_app.rb
class RodauthApp < Roda
  plugin :rodauth, csrf: false, flash: false do
    enable :rails, :login, :create_account, :verify_account, :reset_password, :logout
    # ... rodauth configuration ...
  end

  route do |r|
    r.rodauth # handle rodauth requests
  end
end
```
```rb
# lib/rodauth/features/rails.rb
module Rodauth
  Feature.define(:rails, :Rails) do
    # ... rails integration ...
  end
end
```
```rb
# config/initializers/rodauth.rb
class RodauthMiddleware
  def initialize(app)
    @app = app
  end

  def call(env)
    RodauthApp.new(@app).call(env) # keeps RodauthApp reloadable
  end
end

Rails.application.config.middleware.use RodauthMiddleware
```

Once I felt things were functioning well enough, I extracted the glue code into the [rodauth-rails] gem and added tests. I also included an install generator, which created the initial skeleton with sensible default configuration. A new Roda superclass provided a convenience `configure` method for loading the Rodauth plugin together with the `rails` feature.

```sh
$ bundle add rodauth-rails
$ rails generate rodauth:install
```
```rb
# app/misc/rodauth_app.rb
class RodauthApp < Rodauth::Rails::App
  configure do # automatically loads the rails feature
    enable :login, :create_account, :verify_account, :reset_password, :logout
    # ... rodauth configuration ...
  end

  route do |r|
    r.rodauth # handle rodauth requests
  end
end
```

By default, Rodauth uses database authentication functions for password matching, which coupled with a [two-user database setup] allows protecting password hashes even in case of SQL injection ([read here][database functions] on how this works). However, I felt this complexity could be daunting when getting started, so I changed the default to do password matching in ruby instead.

```rb
use_database_authentication_functions? false
account_password_hash_column :password_hash
```

Rodauth also optionally uses [HMACs] for signing tokens, providing additional security. Since this is quite important, rodauth-rails turns this on by setting the HMAC secret to the Rails' secret key base.

```rb
hmac_secret { Rails.application.secret_key_base }
```

## Active Record

While Rodauth uses Sequel for database interaction, most Rails apps are using Active Record. This meant Rodauth needed to work seamlessly alongside Active Record.

One idea was to develop a Rodauth extension that replaces all Sequel calls with Active Record code. However, given Rodauth's advanced SQL usage, that would've been a monumental effort. It would also have been a huge maintenance burden, since the extension would break with new Rodauth changes, and 3rd-party Rodauth extensions would need to maintain their own Active Record integrations.

So, the initial integration simply connected Sequel to the same database Active Record was connected to, which was then picked up by Rodauth.

```rb
db_config = ActiveRecord::Base.connection_db_config

Sequel.connect(adapter: db_config.adapter, database: db_config.database)
```

However, I noticed that this breaks features such as [maintaining test schema], which requires temporarily disconnecting from the database in order to re-create the test database; even though Active Record connections were closed, Sequel was still holding an open connection, which was blocking database dropping. To address this, I extended Active Record to [connect & disconnect Sequel in lockstep with Active Record][lockstep connection].

This worked, but I quickly encountered a new kind of problem. Because Active Record and Sequel used separate database connections, Active Record code couldn't reference records created within a Sequel transaction, because to that connection the record simply doesn't exist (remember, database transactions are tied to a connection).

```rb
class Profile < ActiveRecord::Base
  belongs_to :account
end
```
```rb
class RodauthApp < Rodauth::Rails::App
  configure do
    # we're still in a Sequel transaction that created the account record
    after_create_account do
      # creating an associated record with Sequel worked:
      # db[:profiles].insert(account_id: account_id, name: "New User")

      # but with Active Record it failed with a foreign key constraint violation:
      Profile.create!(account_id: account_id, name: "New User") # ~> account record not found
    end
  end
end
```

My goal was for developers not to have to care that Rodauth uses Sequel, so calling Active Record inside Rodauth should just work. Moreover, [Bruno Sutic] warned me if Sequel uses a separate database connection, it would mean production databases would have up to twice as many open connections. It became apparent this approach could never achieve the desired developer experience.

<blockquote class="twitter-tweet" data-conversation="none"><p lang="en" dir="ltr">Just browsed the repo. Sequel connection is a bummer.</p>&mdash; Josef Strzibny (@strzibnyj) <a href="https://twitter.com/strzibnyj/status/1253344181650518023?ref_src=twsrc%5Etfw">April 23, 2020</a></blockquote> <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>

For the integration to work, I would need to make Sequel reuse Active Record's database connection. I [discussed this idea with Jeremy Evans][sequel discussion] (the lead Sequel maintainer), and he provided me with some guidance, thanks to which I was able to come up a [solution][sequel-activerecord_connection]. It was a Sequel extension that retrieved Active Record connections, kept transaction state and callbacks   synchronized between Sequel and Active Record, integrated SQL instrumentation, and reconciliated adapter differences (see my [previous article] for more details).

```sh
$ bundle add sequel-activerecord_connection
```
```rb
DB = Sequel.postgres(extensions: :activerecord_connection)
DB[:accounts].all # uses Active Record's database connection
```

## Model

Unlike Devise or Sorcery, Rodauth is completely decoupled from models, and any calls need to go through the Rodauth object. If you need to perform Rodauth actions outside of an HTTP request, you can use the [internal request] feature, which makes an actual Rack call to the Rodauth app:

```rb
# performing rodauth actions (class level)
RodauthApp.rodauth.create_account(login: "user@example.com", password: "secret123")
RodauthApp.rodauth.verify_account(account_login: "user@example.com")

# calling rodauth methods (instance level)
rodauth = Rodauth::Rails.rodauth(account_login: "user@example.com")
rodauth.get_password_reset_key(account_id) #=> "DS6dtRNnvzSCWzm8jg4lltOzBE5vTN_xflNdToIPw3A"
rodauth.recovery_codes #=> ["30GRJkr1BheZztvFZcDeRSNy6yhzigXH6zB-yvzP4Io", ...]
```

While I love this decoupling, it would still be nice to be able to at least create accounts and retrieve associations directly through the model. So, I created the [rodauth-model] gem, which provides an interface similar to Active Record's `has_secure_password`, and defines associations based on your Rodauth configuration (together with associated models).

```rb
class Account < ActiveRecord::Base
  include Rodauth::Rails.model
end
```
```rb
# generating a password hash
account = Account.create(email: "user@example.com", password: "secret123")
account.password_hash #=> "$2a$12$k/Ub1I2iomi84RacqY89Hu4.M0vK7klRnRtzorDyvOkVI.hKhkNw."

account.password_reset_key #=> #<Account::PasswordResetKey id: 1, key: "DS6dtRNnvzSCWzm8jg4lltOzBE5vTN_xflNdToIPw3A" ...>
account.recovery_codes #=> [#<Account::RecoveryCode id: 1, code: "30GRJkr1BheZztvFZcDeRSNy6yhzigXH6zB-yvzP4Io">, ...]
```

Rodauth stores account statuses (unverified, verified, closed) as integers, but we can use [`ActiveRecord::Enum`][activerecord enum] to map them to strings, which is what the install generator now does.

```rb
class Account < ActiveRecord::Base
  # ...
  enum :status, unverified: 1, verified: 2, closed: 3
end
```
```rb
account = Account.find(123)
account.status #=> "unverified"

account.verified? #=> false
account.status = "verified"
account.verified? #=> true

Account.closed #=> [#<Account id: 456, status: "closed" ...>, ...]
```

## Routes introspection

In this architecture, Rodauth routes are handled by the Rack middleware that's sitting in front of the Rails router. This has the benefit of allowing you to perform authentication actions such as requiring authentication, checking active sessions, and remembering from cookie in a single place, thus better encapsulating authentication logic.

However, since Rodauth routes aren't registered within the Rails router, they don't show up in `rails routes`. Rails' routes introspection doesn't currently have capability of registering custom routes, and Roda's routing is [dynamic][roda article], so it's not possible to retrieve its routes programmatically.

Eventually I managed to implement a [`rodauth:routes`][routes task] Rake task, which retrieves the route paths from the Rodauth app, and parses the source code for HTTP verbs. It's not ideal, but it should be good enough.

```sh
$ rails rodauth:routes
# Routes handled by RodauthApp:
# 
#   GET/POST  /login                   rodauth.login_path
#   GET/POST  /create-account          rodauth.create_account_path
#   POST      /email-auth-request      rodauth.email_auth_request_path
#   GET/POST  /email-auth              rodauth.email_auth_path
#   GET/POST  /logout                  rodauth.logout_path
#   GET/POST  /reset-password-request  rodauth.reset_password_request_path
#   GET/POST  /reset-password          rodauth.reset_password_path
#   GET/POST  /change-password         rodauth.change_password_path
#   GET/POST  /change-login            rodauth.change_login_path
#   GET/POST  /verify-login-change     rodauth.verify_login_change_path
#   GET/POST  /close-account           rodauth.close_account_path
#   GET/POST  /verify-account-resend   rodauth.verify_account_resend_path
#   GET/POST  /verify-account          rodauth.verify_account_path
# 
#   GET       /admin/multifactor-manage      rodauth(:admin).two_factor_manage_path
#   GET       /admin/multifactor-auth        rodauth(:admin).two_factor_auth_path
#   GET/POST  /admin/multifactor-disable     rodauth(:admin).two_factor_disable_path
#   GET/POST  /admin/otp-auth                rodauth(:admin).otp_auth_path
#   GET/POST  /admin/otp-setup               rodauth(:admin).otp_setup_path
#   GET/POST  /admin/otp-disable             rodauth(:admin).otp_disable_path
#   GET/POST  /admin/recovery-auth           rodauth(:admin).recovery_auth_path
#   GET/POST  /admin/recovery-codes          rodauth(:admin).recovery_codes_path
#   POST      /admin/unlock-account-request  rodauth(:admin).unlock_account_request_path
#   GET/POST  /admin/unlock-account          rodauth(:admin).unlock_account_path
```

## Generators

Before working on this gem, I didn't realize how important code generators are for convenience, and also how difficult they are to get right. There are currently three generators rodauth-rails ships with:

* `rodauth:install` – sets up initial skeleton with default auth features and migrations
* `rodauth:views` – imports ERB view templates for customization
* `rodauth:migration` – generates migrations for selected authentication features

The generators needed to handle various scenarios, such as RSpec vs Minitest, fixtures vs factory_bot, Active Record vs Sequel, different SQL adapters, API-only mode, UUID primary keys, and more.

### Schema migrations

I wanted to remove any Sequel code from sight, so I translated [Sequel migrations] into Active Record code, and generated those in Active Record migrations. If Sequel happens to be used as the main database library, we'd generate Sequel migrations instead.

```sh
$ rails generate rodauth:migration otp active_sessions
# create  db/migrate/20221012110706_create_rodauth_otp_active_sessions.rb
```
```rb
class CreateRodauthOtpActiveSessions < ActiveRecord::Migration[7.0]
  def change
    # Used by the otp feature
    create_table :account_otp_keys do |t|
      t.foreign_key :accounts, column: :id
      t.string :key, null: false
      t.integer :num_failures, null: false, default: 0
      t.datetime :last_use, null: false, default: -> { "CURRENT_TIMESTAMP" }
    end

    # Used by the active sessions feature
    create_table :account_active_session_keys, primary_key: [:account_id, :session_id] do |t|
      t.references :account, foreign_key: true
      t.string :session_id
      t.datetime :created_at, null: false, default: -> { "CURRENT_TIMESTAMP" }
      t.datetime :last_use, null: false, default: -> { "CURRENT_TIMESTAMP" }
    end
  end
end
```

### View templates

The [built-in view templates][rodauth templates] use [Tilt]'s interpolated string engine, which avoids ERB dependency, but requires work to adapt for Rails. So, rodauth-rails' views generator imports already converted [ERB view templates][rodauth-rails templates] that use familiar Rails' form helpers.

```sh
$ rails generate rodauth:views login create_account lockout 
# create  app/views/rodauth/_login_form.html.erb
# create  app/views/rodauth/_login_form_footer.html.erb
# create  app/views/rodauth/_login_form_header.html.erb
# create  app/views/rodauth/login.html.erb
# create  app/views/rodauth/multi_phase_login.html.erb
# create  app/views/rodauth/create_account.html.erb
# create  app/views/rodauth/unlock_account_request.html.erb
# create  app/views/rodauth/unlock_account.html.erb
```
```erb
<%= form_with url: rodauth.unlock_account_path, method: :post, data: { turbo: false } do |form| %>
  <%== rodauth.unlock_account_explanatory_text %>

  <% if rodauth.unlock_account_requires_password? %>
    <div class="mb-3">
      <%= form.label "password", rodauth.password_label, class: "form-label" %>
      <%= form.password_field rodauth.password_param, value: "", id: "password", autocomplete: rodauth.password_field_autocomplete_value, required: true, class: "form-control #{"is-invalid" if rodauth.field_error(rodauth.password_param)}", aria: ({ invalid: true, describedby: "password_error_message" } if rodauth.field_error(rodauth.password_param)) %>
      <%= content_tag(:span, rodauth.field_error(rodauth.password_param), class: "invalid-feedback", id: "password_error_message") if rodauth.field_error(rodauth.password_param) %>
    </div>
  <% end %>

  <div class="mb-3">
    <%= form.submit rodauth.unlock_account_button, class: "btn btn-primary" %>
  </div>
<% end %>
```

Because not all Rodauth actions are Turbo-compatible (multi-phase login and viewing recovery codes return a 200 response on form submits), I have chosen to disable Turbo by default for all HTML forms, to ensure everything works.

## Future plans

* I would like the migration generator to support database authentication functions, to make it easier for developers to better secure their password hashes. I have been working on it on & off, but it's fairly complex to generate correct migration code, especially since different SQL databases (PostgreSQL, MySQL, SQL Server) require different setups.

* Default Rodauth view templates use Bootstrap markup, but Ben Koshy has been working on adding [Tailwind CSS support][tailwind templates], which will be a nice addition. You'll be able to pass `--css=tailwind`, which will be the default when the `tailwindcss-rails` gem is used.

* I want to make it easier for 3rd-party Rodauth extensions to provide migrations/views for Rails generators. The [rodauth-oauth] gem currently provides its own generators (`rodauth:oauth:install` and `rodauth:oauth:views`), but it would be nice if they didn't have to be duplicated.

* Rodauth methods are called through the Rodauth object, and you're encouraged to define convenience controller/view helpers that suit your application's needs. That being said, having some default helpers [like Devise has][devise helpers] (and even something like [Devise groups]) probably might go a long way. I was also considering more convenient routing helpers, perhaps even a builder for defining custom ones.

  ```rb
  # config/routes.rb
  Rails.application.routes.draw do
    # this is what we have today
    constraints Rodauth::Rails.authenticated do
      # ...
    end

    # but maybe Devise syntax is worthwhile
    authenticate do
      # ...
    end
  end
  ```

## Closing words

There are many more things the Rails integration takes care of, such as ignoring asset requests from Sprockets or Propshaft, instrumentation/logging of Rodauth requests, executing controller callbacks & rescue handlers, handling background emails, testing helpers, and Rails 4.2+ & JRuby support. But I think I rambled on for long enough.

The purpose for this article wasn't to bolster on my achievements, but to share my realization about the price of convenience, and how much work it can actually take integrate a generic library into Rails, especially when it does the work of a Rails engine. I cannot thank Jeremy Evans enough for discussing, reviewing, and merging [every one of my additions][janko prs] to Rodauth that helped enable a smooth Rails integration :pray:

I hope I fulfilled my goal of making Rodauth easy to work with in Rails. That being said, I'm grateful for the continuous feedback I'm getting from people that are using Rodauth. I'm trying to convert many of my answers into a [wiki page][rodauth-rails wiki], a [how-to guide][rodauth guides] or a [screencast], to grow the knowledge around handling common use cases.

[Rodauth]: https://github.com/jeremyevans/rodauth
[Roda]: https://github.com/jeremyevans/roda
[Sequel]: https://github.com/jeremyevans/sequel
[old demo]: https://github.com/jeremyevans/rodauth-demo-rails/blob/master/config/initializers/rodauth.rb
[roda-rails]: https://github.com/jeremyevans/roda-rails
[vast feature set]: https://rodauth.jeremyevans.net/documentation.html#plugins
[new demo]: https://github.com/janko/rodauth-demo-rails
[iteration 1]: https://github.com/janko/rodauth-demo-rails/commit/8affb9499801b6d2545f57b1554295f03502d2fa#diff-3c9dfcead9f75d230dc142b713a4bfc1e95faf07a3a027176b46519d95468453
[iteration 2]: https://github.com/janko/rodauth-demo-rails/commit/e69f9bd2149760d4d5e47ecf23d6239dc5448497#diff-c2af93c5a8391da5143ed228699395dc7ac8722b9e184abad40b4ea3213bacd5
[proxy middleware]: https://github.com/janko/rodauth-demo-rails/commit/8affb9499801b6d2545f57b1554295f03502d2fa#diff-b5224e97c3a9a105e9d12aafa5c157918930b3786a2ac169001250386316c0dfR11-R22
[rodauth-rails]: https://github.com/janko/rodauth-rails
[rodauth-rails templates]: https://github.com/janko/rodauth-rails/tree/2b54cba3018d95940fd34af0bc0b17a540b8d2ea/lib/generators/rodauth/templates/app/views/rodauth
[rodauth templates]: https://github.com/jeremyevans/rodauth/tree/master/templates
[maintaining test schema]: https://guides.rubyonrails.org/testing.html#maintaining-the-test-database-schema
[lockstep connection]: https://github.com/janko/rodauth-rails/blob/2b54cba3018d95940fd34af0bc0b17a540b8d2ea/lib/rodauth/rails/active_record_extension.rb
[sequel discussion]: https://groups.google.com/g/sequel-talk/c/yQt4ptIDQO4/m/U7yghTFKBAAJ
[Bruno Sutic]: https://github.com/bruno-
[sequel-activerecord_connection]: https://github.com/janko/sequel-activerecord_connection
[previous article]: https://janko.io/how-i-enabled-sequel-to-reuse-active-record-connection/
[internal request]: http://rodauth.jeremyevans.net/rdoc/files/doc/internal_request_rdoc.html
[activerecord enum]: https://api.rubyonrails.org/classes/ActiveRecord/Enum.html
[rodauth-model]: https://github.com/janko/rodauth-model
[database functions]: https://github.com/jeremyevans/rodauth#label-Password+Hash+Access+Via+Database+Functions
[two-user database setup]: https://github.com/jeremyevans/rodauth#label-PostgreSQL+Database+Setup
[HMACs]: https://github.com/jeremyevans/rodauth#label-HMAC
[Sequel migrations]: http://rodauth.jeremyevans.net/rdoc/files/README_rdoc.html#label-Creating+tables
[Tilt]: https://github.com/rtomayko/tilt
[tailwind templates]: https://github.com/janko/rodauth-rails/pull/114
[devise helpers]: https://github.com/heartcombo/devise#controller-filters-and-helpers
[Devise groups]: https://github.com/heartcombo/devise/blob/6d32d2447cc0f3739d9732246b5a5bde98d9e032/lib/devise/controllers/helpers.rb#L18-L38
[janko prs]: https://github.com/jeremyevans/rodauth/pulls?q=is%3Apr+author%3Ajanko
[rodauth-oauth]: https://github.com/HoneyryderChuck/rodauth-oauth
[rodauth-rails wiki]: https://github.com/janko/rodauth-rails/wiki
[rodauth guides]: https://rodauth.jeremyevans.net/documentation.html#guides
[screencast]: https://www.youtube.com/user/Junky098
[roda article]: https://janko.io/introduction-to-roda/
[routes task]: https://github.com/janko/rodauth-rails/blob/169e9e06bf9cf0dc4ecfe669af2f7f542bf5ba63/lib/rodauth/rails/tasks.rake
