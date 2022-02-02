---
title: Adding Multifactor Authentication in Rails with Rodauth
tags: rodauth
---

Multi-factor authentication or MFA (generalized two-factor authentication or
2FA) is a method of authentication where the user is required to provide two or
more pieces of evidence ("factors") in order to be granted access. Typically
the user would first prove knowledge of something only they *know* (e.g. their
password), and then prove posession of something only they *own* (e.g. another
device). This provides an extra layer of security for the user's account.

Most common multifactor authentication methods include:

* **TOTP** (Time-based One-Time Passwords) – user has an app installed on
  their device that displays the authentication code, which is refreshed every
  30 seconds

* **SMS codes** – user receives authentication codes on their phone via SMS
  when the application requests them

* **Recovery codes** – user is given a fixed set of one-time codes they can
  enter when logging in (this is typically used as a backup method)

* **[WebAuthn]** – user authenticates themselves using a [security key][u2f] or
  built-in platform biometric sensors (e.g. fingerprint)

In this article, I want to show you how to add multifactor authentication to
a Rails app using [Rodauth], which has built-in support for each of the
multifactor authentication methods mentioned above. Compared to alternatives[^1],
Rodauth provides a much more integrated experience by shipping with complete
endpoints, default HTML templates, session management, lockout logic and
more[^2]. To keep the tutorial focused, we'll be implementing just the first
three methods, as they're by far the most common.

We'll be using the [rodauth-rails] gem, and we'll be continuing off of the
application we started building in [my previous article][rodauth basic]. The
goal functionality: allow users to set up TOTP as their primary MFA method, and
use SMS codes and recovery codes as backup MFA methods.

## TOTP

The TOTP functionality is provided by Rodauth's [`otp`][otp] feature. It
depends on the [rotp] and [rqrcode] gems, so let's first install those:

```sh
$ bundle add rotp rqrcode
```

Next, we need to create the required database table. For this we'll use the
migration generator provided by rodauth-rails:

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
# app/misc/rodauth_main.rb
class RodauthMain < Rodauth::Rails::Auth
  configure do
    # ...
    enable :otp
  end
end
```

This adds the following routes to our application:

* `/otp-auth` – authenticate via TOTP code
* `/otp-setup` – set up TOTP authentication
* `/otp-disable` – disable TOTP authentication
* `/multifactor-manage` – set up or disable available MFA methods
* `/multifactor-auth` – authenticate via available MFA methods
* `/multifactor-disable` – disable all MFA methods

To allow the user to configure MFA, let's display a link to the
`/multifactor-manage` route for managing MFA methods in our views:

```erb
<!-- app/views/application/_navbar.html.erb -->
<% if rodauth.logged_in? %>
  <!-- ... --->
  <%= link_to "Manage MFA", rodauth.two_factor_manage_path, class: "dropdown-item" %>
  <!-- ... --->
<% end %>
```

Now when the user logs in and clicks on "Manage MFA", they'll get redirected to
the OTP setup page that Rodauth provides out-of-the-box[^3]:

![Rodauth OTP setup page](/images/rodauth-otp-setup.png)

The user can now scan the QR code using an authenticator app such as Google
Authenticator, Microsoft Authenticator or Authy, and enter the OTP code (along
with their current password) to finish setting up OTP. As a developer, you can
generate the code in ruby using the OTP secret shown on the setup page:

```sh
$ ruby -r rotp -e 'puts ROTP::TOTP.new("<secret>").now'
409761
```

When the user with OTP set up logs in the next time, we want to redirect them
automatically to the OTP auth page, and generally require logged in users that
have MFA setup to authenticate with 2nd factor. This can be achieved with the
following configuration:

```rb
# app/misc/rodauth_main.rb
class RodauthMain < Rodauth::Rails::Auth
  configure do
    # ...
    # redirect the user to the MFA page if they have MFA setup
    login_redirect do
      if uses_two_factor_authentication?
        two_factor_auth_required_redirect
      else
        "/"
      end
    end
  end
end
```
```rb
# app/misc/rodauth_app.rb
class RodauthApp < Rodauth::Rails::App
  # ...
  route do |r|
    # ...
    # require MFA if the user is logged in and has MFA setup
    if rodauth.logged_in? && rodauth.uses_two_factor_authentication?
      rodauth.require_two_factor_authenticated
    end
  end
end
```

![Rodauth TOTP authentication page](/images/rodauth-otp-auth.png)

## Recovery codes

After the user sets up TOTP, it's recommended to also generate a set of
"recovery" codes for them to save somewhere, which they can use on login in
case they lose access to their TOTP device. This functionality is provided by
Rodauth's [`recovery_codes`][recovery codes] feature.

Let's start by creating the required database table:

```sh
$ rails generate rodauth:migration recovery_codes
# create  db/migrate/20201214200106_create_rodauth_recovery_codes.rb

$ rails db:migrate
# == 20201217071036 CreateRodauthRecoveryCodes: migrating =======================
# -- create_table(:account_recovery_codes, {:primary_key=>[:id, :code]})
# == 20201217071036 CreateRodauthRecoveryCodes: migrated ========================
```

And enabling the `recovery_codes` feature in our Rodauth configuration:

```rb
# app/misc/rodauth_main.rb
class RodauthMain < Rodauth::Rails::Auth
  configure do
    # ...
    enable :otp, :recovery_codes
  end
end
```

This adds the following routes to our app:

* `/recovery-auth` – authenticate via a recovery code
* `/recovery-codes` – view & add recovery codes

We'll now override the `after_otp_setup` hook to display recovery codes to the
user after they've successfully set up TOTP, instead of the default redirect.

```rb
# app/misc/rodauth_main.rb
class RodauthMain < Rodauth::Rails::Auth
  configure do
    # ...
    # auto generate recovery codes after TOTP setup
    auto_add_recovery_codes? true
    # display recovery codes after TOTP setup
    after_otp_setup do
      set_notice_now_flash "#{otp_setup_notice_flash}, please make note of your recovery codes"
      response.write add_recovery_codes_view
      request.halt # don't process the request any further
    end
  end
end
```

We'll also override the default Rodauth template to display the recovery codes
in a nicer way and add a download link for convenience.

```sh
$ rails generate rodauth:views recovery_codes
```
```erb
<!-- app/views/rodauth/add_recovery_codes.html.erb -->
<% content_for :title, rodauth.add_recovery_codes_page_title %>

<% if rodauth.recovery_codes.any? %>
  <p class="my-3">
    Copy these recovery codes to a safe location.
    You can also download them <%= link_to "here", download_recovery_codes_path %>.
  </p>

  <div class="d-inline-block mb-3 border border-info rounded px-3 py-2">
    <% rodauth.recovery_codes.each_slice(2) do |code1, code2| %>
      <div class="row text-info text-left">
        <div class="col-lg my-1 font-monospace"><%= code1 %></div>
        <div class="col-lg my-1 font-monospace"><%= code2 %></div>
      </div>
    <% end %>
  </div>
<% end %>

<!-- Used for filling in missing recovery codes later on -->
<% if rodauth.can_add_recovery_codes? %>
  <%== rodauth.add_recovery_codes_heading %>
  <%= render template: "rodauth/recovery_codes", layout: false %>
<% end %>
```
```rb
# config/routes.rb
Rails.application.routes.draw do
  # ...
  controller :rodauth do
    get "download-recovery-codes"
  end
end
```
```rb
# app/controllers/rodauth_controller.rb
class RodauthController < ApplicationController
  def download_recovery_codes
    rodauth.require_authentication

    send_data rodauth.recovery_codes.join("\n"),
      filename: "myapp-recovery-codes.txt",
      type: "text/plain"
  end
end
```

When the user now sets up TOTP, they will be shown a page like this:

![Rodauth page for viewing and downloading recovery codes](/images/rodauth-recovery-view.png)

And when they log into their account the next time, on the multifactor auth
page they can choose to enter a recovery code instead of TOTP.

![Multifactor auth page with OTP and recovery codes options](/images/rodauth-recovery-auth.png)

## SMS codes

In addition to TOTP, it's good practice to also provide the ability to use SMS
codes for 2nd factor authentication. Rodauth provides a specialized
[`sms_codes`][sms_codes] feature for this.

To set it up, we again create the required database table:

```sh
$ rails generate rodauth:migration sms_codes
# create  db/migrate/20201219173710_create_rodauth_sms_codes.rb

$ rails db:migrate
# == 20201219173710 CreateRodauthSmsCodes: migrating ==================
# -- create_table(:account_sms_codes)
# == 20201219173710 CreateRodauthSmsCodes: migrated ===================
```

And enable the `sms_codes` feature in the Rodauth configuration:

```rb
# app/misc/rodauth_main.rb
class RodauthMain < Rodauth::Rails::Auth
  configure do
    # ...
    enable :otp, :recovery_codes, :sms_codes
  end
end
```

This adds the following routes to our app:

* `/sms-request` – request the SMS code to be sent
* `/sms-auth` – authenticate via an SMS code
* `/sms-setup` – set up SMS codes authentication
* `/sms-confirm` – confirm the provided phone number
* `/sms-disable` – disable SMS codes authentication

When an SMS code is requested, Rodauth calls the `sms_send` method with the
configured phone number and a corresponding text message. This method isn't
defined by default, since Rodauth doesn't know how we want to send the SMS,
instead we're expected to implement `sms_send`:

```rb
# app/misc/rodauth_main.rb
class RodauthMain < Rodauth::Rails::Auth
  configure do
    # ...
    sms_send do |phone, message|
      # we need to implement this
    end
  end
end
```

We'll use [Twilio] for sending SMS messages. Assuming we've set up an account,
we'll add the account SID, auth token, and phone number to Rails credentials:

```sh
$ rails credentials:edit
```
```yml
twilio:
  account_sid: <YOUR_ACCOUNT_SID>
  auth_token: <YOUR_AUTH_TOKEN>
  phone_number: <YOUR_PHONE_NUMBER>
```

Next, we'll install the [twilio-ruby] and [dry-initializer] gems, and create a
wrapper class for the Twilio client:

```sh
$ bundle add twilio-ruby dry-initializer
```
```rb
# app/misc/twilio_client.rb
class TwilioClient
  Error              = Class.new(StandardError)
  InvalidPhoneNumber = Class.new(Error)

  extend Dry::Initializer

  option :account_sid,  default: -> { Rails.application.credentials.twilio[:account_sid] }
  option :auth_token,   default: -> { Rails.application.credentials.twilio[:auth_token] }
  option :phone_number, default: -> { Rails.application.credentials.twilio[:phone_number] }

  def send_sms(to, message)
    client.messages.create(from: phone_number, to: to, body: message)
  rescue Twilio::REST::RestError => error
    # more details here: https://www.twilio.com/docs/api/errors/21211
    raise TwilioClient::InvalidPhoneNumber, error.message if error.code == 21211
    raise TwilioClient::Error, error.message
  end

  def client
    Twilio::REST::Client.new(account_sid, auth_token)
  end
end
```

Finally, we'll implement `sms_send` using our new `TwilioClient` class,
converting SMS sending errors into validation errors:

```rb
# app/misc/rodauth_main.rb
class RodauthMain < Rodauth::Rails::Auth
  configure do
    # ...
    sms_send do |phone, message|
      twilio = TwilioClient.new
      twilio.send_sms(phone, message)
    rescue TwilioClient::InvalidPhoneNumber
      throw_error_status(422, sms_phone_param, sms_invalid_phone_message)
    rescue TwilioClient::Error
      throw_error_status(500, sms_phone_param, "sending the SMS code failed")
    end
  end
end
```

When the user now visits the SMS authentication setup page on the multifactor
manage page, they can enter their phone number and password, and then enter the
SMS code they received to finish the SMS authentication setup.

![Rodauth SMS authentication setup page](/images/rodauth-sms-setup.png)

Afterwards, when the user logs in the next time, in addition to authenticating
via TOTP or a recovery code, they'll now also be able to choose to authenticate
via SMS.

## Disabling multifactor authentication

In addition to setup and authentication, Rodauth also provides endpoints for
disabling any MFA method, which require the user to confirm their password:

* `/otp-disable` – disable OTP authentication
* `/sms-disable` – disable multifactor authentication
* `/multifactor-disable` – disable all multifactor methods

The links for disabling MFA methods that have previously been set up are
automatically displayed on the multifactor manage page:

![Rodauth links for disabling configured MFA methods](/images/rodauth-mfa-disable.png)

Disabling a MFA method will take care of deleting any records associated to
that account from the corresponding database table.

## Closing words

In this tutorial we've shown how to add multifactor authentication
functionality in Rails with Rodauth and rodauth-rails. We've enabled the
user to set up TOTP as their primary MFA method, after which they receive a set
of recovery codes, and have the possibility to also set up SMS as a backup MFA
method.

We've seen that Rodauth ships with complete endpoints and default HTML
templates for managing multiple MFA methods, and generally provides a much more
integrated experience compared to the alternatives. Given that multifactor
authentication is becoming an increasingly common requirement, it's very useful
to have a framework that supports it with the same level of standard as the
other authentication features.

[^1]: At the time of writing, most popular alternatives are [devise-two-factor], [active_model_otp], and [two_factor_authentication].
[^2]: See the source code for [OTP][otp source], [SMS Codes][sms source], [Recovery Codes][recovery source], and [Two Factor Base][mfa source] for more details.
[^3]: You can override the default template by running `rails generate rodauth:views otp` and modifying `app/views/rodauth/otp_setup.html.erb`.

[u2f]: https://en.wikipedia.org/wiki/Universal_2nd_Factor
[Rodauth]: https://github.com/jeremyevans/rodauth/
[rodauth-rails]: https://github.com/janko/rodauth-rails
[rodauth basic]: /adding-authentication-in-rails-with-rodauth/
[devise-two-factor]: https://github.com/tinfoil/devise-two-factor
[active_model_otp]: https://github.com/heapsource/active_model_otp
[two_factor_authentication]: https://github.com/Houdini/two_factor_authentication
[otp]: http://rodauth.jeremyevans.net/rdoc/files/doc/otp_rdoc.html
[rotp]: https://github.com/mdp/rotp
[rqrcode]: https://github.com/whomwah/rqrcode
[recovery codes]: http://rodauth.jeremyevans.net/rdoc/files/doc/recovery_codes_rdoc.html
[sms_codes]: http://rodauth.jeremyevans.net/rdoc/files/doc/sms_codes_rdoc.html
[Twilio]: https://www.twilio.com/
[twilio-ruby]: https://github.com/twilio/twilio-ruby
[dry-initializer]: https://dry-rb.org/gems/dry-initializer
[otp source]: https://github.com/jeremyevans/rodauth/blob/master/lib/rodauth/features/otp.rb
[sms source]: https://github.com/jeremyevans/rodauth/blob/master/lib/rodauth/features/sms_codes.rb
[recovery source]: https://github.com/jeremyevans/rodauth/blob/master/lib/rodauth/features/recovery_codes.rb
[mfa source]: https://github.com/jeremyevans/rodauth/blob/master/lib/rodauth/features/two_factor_base.rb
[WebAuthn]: https://webauthn.io/
[Turbo]: https://turbo.hotwired.dev/
