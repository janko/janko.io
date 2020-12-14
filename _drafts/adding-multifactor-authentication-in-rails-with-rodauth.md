---
title: Adding Multifactor Authentication in Rails 6 with Rodauth
tags: rodauth
---

Multi-factor authentication or MFA (generalized two-factor authentication or
2FA) is method of authentication where the user is required to provide two or
more pieces of evidence (or "factors") in order to be granted access. Typically
the user would first prove knowledge of something only they *know* (e.g. their
password), and then prove posession of something only they *own* (e.g. another
device). This provides additional security for the user's account.

Most common multifactor authentication methods include:

* **TOTP** (Time-based One-Time Passwords) – the user has an app installed on
  their device that shows the authentication code, which is refreshed every 30
  seconds

* **SMS codes** – the user receives authentication codes on their phone via SMS
  when the app requests them

* **Recovery codes** – the user is given a fixed set of one-time codes they can
  enter when logging in (this is typically used as a backup method)

* **WebAuthn** – the user authenticates themselves using a [U2F security
  key][u2f] device

In this article, I want to show you how to add multifactor authentication to
a Rails 6 app using [Rodauth], which has built-in support for each of the
multifactor authentication methods mentioned above (and provides a more
integrated experience compared to gems like [devise-two-factor]). To keep the
tutorial focused, we'll be implementing only the first three methods, as
they're by far the most common.

We'll be using [rodauth-rails], and we'll be continuing off of the application
we started building in [my previous article][rodauth basic]. The goal
functionality: allow users to set up TOTP as their primary MFA method, and use
SMS codes and recovery codes as backup MFA methods.

## TOTP

This functionality is provided by Rodauth's [OTP] feature. It depends on the
[rotp] and [rqrcode] gems, so let's first install them:

```sh
$ bundle add rotp rqcode
```

Next, we need to create the database table that will be used for storing OTP
secret keys. We'll use the migration generator provided by rodauth-rails:

```sh
$ rails generate rodauth:migration otp
# create  db/migrate/20201214200106_create_rodauth_otp.rb

$ rails db:migrate
# == 20201214200106 CreateRodauthOtp: migrating =======================
# -- create_table(:account_otp_keys)
# == 20201214200106 CreateRodauthOtp: migrated ========================
```

Now we can enable the `otp` feature in our Rodauth configuration:

```rb
# app/lib/rodauth.rb
class RodauthApp < Rodauth::Rails::App
  configure do
    # ...
    enable :otp
  end
end
```

To allow the user to configure MFA, let's add some links provided by Rodauth
to our views:

```erb
<!-- app/views/application/_navbar.html.erb -->
<!-- ... --->
<% if rodauth.uses_two_factor_authentication? %>
  <%= link_to "Manage MFA", rodauth.two_factor_manage_path, class: "dropdown-item" %>
  <%= link_to "Disable MFA", rodauth.two_factor_disable_path, class: "dropdown-item" %>
<% else %>
  <%= link_to "Setup MFA", rodauth.two_factor_manage_path, class: "dropdown-item" %>
<% end %>
<!-- ... --->
```

Now when the user logs in and clicks on "Manage MFA", they'll get redirected to
the OTP setup page that Rodauth provides out-of-the-box:

![Rodauth OTP setup page](/images/rodauth-otp-setup.png)

The user can now scan the QR code using an authenticator app such as Google
Authenticator, Microsoft Authenticator or Authy, and enter the OTP code (and
current password) to finish setting up OTP. After that they should get a
confirmation message:

![Rodauth OTP setup successful flash message](/images/rodauth-otp-setup-flash.png)

When the user logs in the next time, we want to redirect them automatically to
the OTP auth page, and generally require logged in users that have MFA setup to
authenticate with 2nd factor. This can be achieved with the following
configuration:

```rb
# app/lib/rodauth_app.rb
class RodauthApp < Rodauth::Rails::App
  configure do
    # ...
    two_factor_auth_required_redirect { otp_auth_path }
    login_redirect { uses_two_factor_authentication? ? otp_auth_path : "/" }
  end

  route do |r|
    # ...
    if rodauth.logged_in? && rodauth.uses_two_factor_authentication?
      rodauth.require_two_factor_authenticated
    end
  end
end
```

We now have a working implementation of multifactor authentication with TOTP.

## SMS codes

## Recovery codes

## Disabling multifactor authentication

## Closing words

[u2f]: https://en.wikipedia.org/wiki/Universal_2nd_Factor
[Rodauth]: https://github.com/jeremyevans/rodauth/
[rodauth-rails]: https://github.com/janko/rodauth-rails
[rodauth basic]: /adding-authentication-in-rails-with-rodauth/
[devise-two-factor]: https://github.com/tinfoil/devise-two-factor
[OTP]: http://rodauth.jeremyevans.net/rdoc/files/doc/otp_rdoc.html
[rotp]: https://github.com/mdp/rotp
[rqrcode]: https://github.com/whomwah/rqrcode
