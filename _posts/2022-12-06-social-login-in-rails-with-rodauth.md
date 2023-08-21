---
title: Social Login in Rails with Rodauth
tags: rodauth
---

[OmniAuth] provides a standardized interface for authenticating with various external providers. Once the user authenticates with the provider, it's up to us developers to handle the callback and implement actual login and registration into the app. There is a [wiki page][omniauth guide] laying out various scenarios that need to be handled if you want to support multiple providers, showing that it's by no means a trivial task.

While Devise provides a convenience layer around OmniAuth, it does nothing to actually sign the user into your app. When I started writing the OmniAuth integration for [Rodauth], I wanted to go one step further and actually handle things like persistence of external identities, account creation and login, while still allowing the developer to customize the behaviour. That's how [rodauth-omniauth] was created. :sparkles:

In this article, I will show how to add social login to an existing Rails app that's using Rodauth, and extend the default behaviour with some custom logic. If you're looking to get started with Rodauth, check out [my previous article][rodauth rails intro]. With that out of the way, let's dive in.

## Setup

We'll start by installing the Rodauth extension and the desired OmniAuth strategies:

```sh
$ bundle add rodauth-omniauth omniauth-facebook omniauth-google-oauth2
```

You don't need to install any gems for CSRF protection of OmniAuth request endpoints, because rodauth-omniauth will automatically use whichever CSRF protection mechanism Rodauth was configured with, which in case of Rails will be `ActionController::RequestForgeryProtection`.

If you haven't already, create the necessary OAuth apps, and configure the callback URL to be `https://localhost:3000/auth/{provider}/callback`, where `{provider}` is either `facebook` or `google`. We'll save the credentials for the OAuth apps into our project:

```sh
$ rails credentials:edit
```
```yml
# ...
facebook:
  app_id: "<YOUR_APP_ID>"
  app_secret: "<YOUR_APP_SECRET>"
google:
  client_id: "<YOUR_CLIENT_ID>"
  client_secret: "<YOUR_CLIENT_SECRET>"
```

Next, we'll need to create the table that rodauth-omniauth will use for storing external identities:

```sh
$ rails generate migration create_account_identities
$ rails db:migrate
```
```rb
class CreateAccountIdentities < ActiveRecord::Migration
  def change
    create_table :account_identities do |t|
      t.references :account, null: false, foreign_key: { on_delete: :cascade }
      t.string :provider, null: false
      t.string :uid, null: false
      t.index [:provider, :uid], unique: true
    end
  end
end
```

In the Rodauth configuration, we can now enable the `omniauth` feature and register our strategies:

```rb
# app/misc/rodauth_main.rb
class RodauthMain < Rodauth::Rails::Auth
  configure do
    enable :omniauth

    omniauth_provider :facebook,
      Rails.application.credentials.facebook[:app_id],
      Rails.application.credentials.facebook[:app_secret],
      scope: "email"

    omniauth_provider :google_oauth2,
      Rails.application.credentials.google[:client_id],
      Rails.application.credentials.google[:client_secret],
      name: :google # rename it from "google_oauth2"
  end
end
```

Finally, we can import the view templates for the login form, and add the social login links there:

```sh
$ rails generate rodauth:views login
#  create  app/views/rodauth/_login_form.html.erb
#  create  app/views/rodauth/_login_form_footer.html.erb
#  create  app/views/rodauth/_login_form_footer.html.erb
#  create  app/views/rodauth/_login_form_header.html.erb
#  create  app/views/rodauth/login.html.erb
#  create  app/views/rodauth/multi_phase_login.html.erb
```
```erb
<!-- app/views/rodauth/_login_form_footer.html.erb -->
<!-- ... -->
  <li>
    <%= button_to "Login via Facebook", rodauth.omniauth_request_path(:facebook),
      method: :post, data: { turbo: false }, class: "btn btn-link p-0" %>
  </li>
  <li>
    <%= button_to "Login via Google", rodauth.omniauth_request_path(:google),
      method: :post, data: { turbo: false }, class: "btn btn-link p-0" %>
  </li>
<!-- ... -->
```

We're using POST form submits, because OmniAuth doesn't allow GET requests for the request phase anymore by default. You'll notice we had to disable Turbo for the request links, as those redirect to an external authorize URL, which don't support AJAX visits.

Some OAuth authorizations require that the web app is served over HTTPS. Assuming you're using Puma, a quick way to enable this locally would be to install the [localhost] gem, and tell the Rails server you want to use SSL:

```sh
$ bundle add localhost --group development
$ rails server -b ssl://localhost:3000
```

Now you should be able to open `https://localhost:3000/login`, and see the Rodauth login page with social login links.

![Login page with Facebook and Google login links](/images/social-login-links.png)

## Login & Registration

 When we visit the Facebook login link, and authorize the OAuth app, upon returning to the app a new verified account with your Facebook email address should be automatically created, along with the external identity, and you should be logged in.
 
 You should see something like this in the database:

```rb
account = Account.last
#=> #<Account id: 123, status: "verified", email: "janko.marohnic@gmail.com">
account.identities
#=> [#<Account::Identity id: 456, account_id: 123, provider: "facebook", uid: "350872771">]
```

A problem I often experienced as a user was forgetting which social provider I initially logged into on a certain app, and whether I had even logged in with a social provider (though I can now easily determine the latter by checking my password manager). If I would sign in with the wrong provider, this would usually result in a new account being created for me.

Wouldn't it be nice if the app could detect that the email address of my existing account matches the one of the external identity, and automatically assign that identity to the existing account? Well, rodauth-omniauth does that automatically. If I were to authenticate with Google the next time, I would get logged into my existing account, with the new Google identity connected to it.

```rb
account.identities #=> [
#   #<Account::Identity id: 456, account_id: 123, provider: "facebook", uid: "350872771">,
#   #<Account::Identity id: 789, account_id: 123, provider: "google", uid: "987349876343">,
# ]
```

If for whatever reason you want to change or disable this behaviour, you can override `account_from_omniauth`, which is what searches existing accounts when authenticating with a provider for the first time:

```rb
class RodauthMain < Rodauth::Rails::Auth
  configure do
    # ...
    account_from_omniauth do
      # this is roughly the default implementation
      account_table_ds.first(email: omniauth_info["email"])
    end
    # OR
    account_from_omniauth {} # new identity = new account
  end
end
```

## Storing additional data

Let's say users in our app can fill in their full name, and we decided to inherit it from their external identity when possible, to save them extra work.

We'll assume we have a separate `profiles` table associated to accounts, and we're already creating a profile record on normal registration:

```rb
# in a migration:
create_table :profiles do |t|
  t.references :account, null: false, foreign_key: true
  t.string :name
  t.timestamps
end
```
```rb
class RodauthMain < Rodauth::Rails::Auth
  configure do
    # create profile after normal registration
    after_create_account { Profile.create!(account_id: account_id) }
  end
end
```

We can override the hook for creating the account via OmniAuth login, and create the profile with the name prefilled:

```rb
class RodauthMain < Rodauth::Rails::Auth
  configure do
    # create profile after registration through OmniAuth login
    after_omniauth_create_account do
      Profile.create!(account_id: account_id, name: omniauth_info["name"])
    end
  end
end
```

Let's say we now want to store additional data on identities, which by default have only the mandatory `provider` and `uid` columns. We might want to store `created_at` & `updated_at` timestamps, as well as an `email` for each identity. We can start by creating the necessary columns:

```rb
# in a migration:
add_timestamps :account_identities
add_column :account_identities, :email, :string
```

We can now ensure `created_at` is set the first time we authenticate with a provider, and that `updated_at` and `email` are updated each time we authenticate with the provider:

```rb
class RodauthMain < Rodauth::Rails::Auth
  configure do
    # store `created_at` only when the identity is created
    omniauth_identity_insert_hash do
      super().merge(created_at: Time.now)
    end
    # update `updated_at` and `email` each time the identity is updated
    omniauth_identity_update_hash do
      super().merge(updated_at: Time.now, email: omniauth_email)
    end
  end
end
```

Now our account & identity data might look as follows:

```rb
account = Account.last
#=> #<Account id: 123,
#    status: "verified",
#    email: "janko@hey.com",
#    name: "Janko Marohnić">

account.identities.first
#=> #<Account::Identity
#    id: 789,
#    account_id: 123,
#    provider: "google",
#    uid: "987349876343",
#    email: "janko.marohnic@gmail.com",
#    created_at: Fri, 11 Nov 2022 13:11:85 UTC,
#    updated_at: Fri, 02 Dec 2022 08:01:26 UTC>
```

## Multiple account types

If your app has different account types which require potentially different authentication rules, you'll be glad to know that rodauth-omniauth supports distinct configurations.

Let's say we have an **admin** account type, for which we want to provide logging in via GitHub. Assuming we've already created the OAuth app, we'll install the OmniAuth strategy gem:

```sh
$ bundle add omniauth-github
$ rails credentials:edit
```
```yml
# ...
github:
  client_id: "<YOUR_CLIENT_ID>"
  client_secret: "<YOUR_CLIENT_SECRET>"
```

To protect the admin section, we'll only allow users that are members of the company's GitHub organization. For this, we might have the following Rodauth configuration:

```rb
# app/misc/rodauth_admin.rb
class RodauthAdmin < Rodauth::Rails::Auth
  configure do
    enable :omniauth

    prefix "/admin"
    session_key_prefix "admin_"

    omniauth_provider :github,
      Rails.application.credentials.github[:client_id],
      Rails.application.credentials.github[:client_secret]

    before_omniauth_callback_route do
      if omniauth_provider == :github && !organization_member?(omniauth_info["nickname"])
        set_redirect_error_flash "User is not a member of our GitHub organization"
        redirect "/admin"
      end
    end
  end

  private

  def organization_member?(username)
    # ... check if user is a member of company's GitHub organization ...
  end
end
```

Since we've set admin routes to be prefixed with `/admin`, OmniAuth routes will be prefixed as well, so the request phase will be at `/admin/auth/github`. This ensures authentication doesn't overlap with the main account type.

If we had decided to use a separate table for admin accounts (e.g. `admins`), we can also use a separate identities table:

```rb
# in a migration:
create_table :admin_identities do |t|
  t.references :admin, null: false, foreign_key: { on_delete: :cascade }
  t.string :provider, null: false
  t.string :uid, null: false
  t.index [:provider, :uid], unique: true
end
```
```rb
class RodauthAdmin < Rodauth::Rails::Auth
  configure do
    # ...
    omniauth_identities_table :admin_identities
    omniauth_identities_account_id_column :admin_id
  end
end
```

## Future work

### Separate registration step

The current automatic registration assumes the external login will always return the user's email address, which is not always the case (hello Twitter). It also assumes we don't need additional information from the user before creating their account.

After external login, I would like to support having a separate registration step, with fields like email address already being filled in. The main challenge is preventing an attacker from signing up with another person's identity. I would definitely welcome any contributions. :pray:

### Connecting additional identities

Once the user is signed in, it would be useful to allow them to connect additional external identities, as well as disconnect already linked identities, to make future logins more reliable.

<figure>
  <img alt="GitLab section for connection & disconnecting additional external identities" src="/images/connecting-identities.png">
  <figcaption>GitLab account interface</figcaption>
</figure>

This feature seems more straightforward to implement. However, it's tricky to handle the scenario when a logged in user wants to authenticate via a different provider, because by default Rodauth doesn't disallow access to the login page in this case. There are also questions around connecting identities that are currently assigned to a different account.

## Closing words

This was definitely the most challenging Rodauth extension I've built. I had been working on it periodically for 2 years, and was only able to release it once I decided to postpone the mentioned features. It took a while to find the right balance between respecting OmniAuth configuration and Rodauth conventions, support JSON API with JWT, handle inheritance, figure out the OmniAuth 2.0 upgrade, and implement a customizable callback phase.

I was able to do all this thanks to the strong foundation Rodauth provides. Its layered design allowed me to hook at the right level to make it work well with other authentication features, while the [configuration DSL] made it easy to make any part customizable. Because Rodauth supports feature dependencies, I was able to extract the [pure OmniAuth integration][base] for standalone usage, for those who don't need any of the database logic.

While it was previously possible to use OmniAuth directly, I'm happy that Rodauth now has a social login story. Given that this is a much more integrated solution compared to what Devise offers, and other people might have more custom authentication flows, I'm curious to get everyone's feedback. :wink:

[OmniAuth]: https://github.com/omniauth/omniauth
[omniauth guide]: https://github.com/omniauth/omniauth/wiki/Managing-Multiple-Providers
[Rodauth]: https://github.com/jeremyevans/rodauth
[base feature]: https://github.com/janko/rodauth-omniauth/blob/master/lib/rodauth/features/omniauth_base.rb
[rodauth-omniauth]: https://github.com/janko/rodauth-omniauth
[rodauth rails intro]: https://janko.io/adding-authentication-in-rails-with-rodauth/
[localhost]: https://github.com/socketry/localhost
[configuration DSL]: http://rodauth.jeremyevans.net/rdoc/files/doc/guides/internals_rdoc.html#label-Feature+Creation+Example
[base]: https://github.com/janko/rodauth-omniauth#base
[helper methods]: https://github.com/janko/rodauth-omniauth#helpers
