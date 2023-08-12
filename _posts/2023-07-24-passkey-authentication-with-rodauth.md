---
title: Passkey Authentication with Rodauth
---

[Passkeys] are a modern alternative to passwords, where the user's device performs the authentication, usually requiring some form of user verification (biometric identification, PIN). Passkeys are built on top of [WebAuthn] specification, which is based on public-key cryptography. Keypairs are created for each website, and the public key is sent to the server, while the private key is securely stored on the device. This makes passkeys:

* stronger than any password
* safe from data breaches
* safe from phishing attacks

WebAuthn credentials are bound to the device that created them (think security keys like [YubiKey]), which is good for privacy since no company has your data, but losing your device could lock you out of your account. Passkeys add the ability to be backed up to the cloud and synchronized between multiple devices, which reduces the risk of passkeys getting lost.

[Rodauth] provides first class support for passkeys, implemented on top of the excellent [webauthn-ruby] gem. It enables using passkeys as a multifactor authentication method, or for passwordless login and registration. In addition to routes, views and database storage, it also provides the complete [JavaScript part] that interacts with [Web Authentication API] for zero configuration.

In this article, I would like to show how to set each of these up in a Rails app that uses [rodauth-rails]. I'll be using Safari on macOS Ventura, and have iCloud Keychain sync enabled, which is a requirement for Apple passkeys.

## Multifactor authentication

As I mentioned before, Rodauth supports registering passkeys as a multifactor authentication method, in addition to TOTP, recovery codes and SMS codes it already [provides][mfa article].

We'll start by creating the necessary database tables:

```sh
$ rails generate rodauth:migration webauthn
$ rails db:migrate
```
```rb
class CreateRodauthWebauthn < ActiveRecord::Migration
  def change
    # stores WebAuthn user identifiers
    create_table :account_webauthn_user_ids, id: false do |t|
      t.integer :id, primary_key: true
      t.foreign_key :accounts, column: :id
      t.string :webauthn_id, null: false
    end
    # stores WebAuthn credentials
    create_table :account_webauthn_keys, primary_key: [:account_id, :webauthn_id] do |t|
      t.references :account, foreign_key: true
      t.string :webauthn_id
      t.string :public_key, null: false
      t.integer :sign_count, null: false
      t.datetime :last_use, null: false, default: -> { "CURRENT_TIMESTAMP" }
    end
  end
end
```

Next, we'll enable the [`webauthn`](webauthn) feature in our Rodauth configuration:

```rb
# app/misc/rodauth_main.rb
class RodauthMain < Rodauth::Rails::Auth
  configure do
    enable :webauthn
  end
end
```

This will add routes for setting up, authenticating via and removing passkeys:

```sh
$ rails rodauth:routes
# ...
# GET/POST  /webauthn-auth    rodauth.webauthn_auth_path
# GET/POST  /webauthn-setup   rodauth.webauthn_setup_path
# GET/POST  /webauthn-remove  rodauth.webauthn_remove_path
# ...
```

Now when the user navigates to the page for managing multifactor authentication methods, they should see a link for setting up WebAuthn authentication.

![Rodauth WebAuthn setup link](/images/rodauth-webauthn-setup-link.png)

This page will show a button for registering a WebAuthn credential, which is already hooked up with the necessary JavaScript code, so clicking on it should show a native browser dialog for creating a new passkey. Once I verify biometric identification, my 2nd factor is set up.

![Rodauth passkey registration dialog](/images/rodauth-passkey-registration-dialog.png)

When this user is logging in the next time, once they've authenticated with 1st factor, they're given the option to authenticate via a passkey for 2nd factor.

![Rodauth WebAuthn auth link](/images/rodauth-webauthn-auth-link.png)

Just like for registering passkeys, the page for authenticating via a passkey is already hooked up with the necessary JavaScript code, so clicking on the submit button should show a dialog for authenticating with the previously created passkey. Once I verify biometric identification, I'm authenticated with 2nd factor.

![Rodauth passkey authentication dialog](/images/rodauth-passkey-authentication-dialog.png)

## Passwordless login

Once the user has created a passkey for your website, in addition to multifactor authentication, they can also use it for passwordless login. This functionality is provided by the [`webauthn_login`][webauthn_login] feature:

```rb
# app/misc/rodauth_main.rb
class RodauthMain < Rodauth::Rails::Auth
  configure do
    enable :webauthn_login
  end
end
```

This will automatically enable multi-phase login, where the user first enters their email, and then they can choose to authenticate via a password or a passkey. Note that the password field won't be displayed if the user didn't set one when creating their account.

![Rodauth passkey login](/images/rodauth-passkey-login.png)

Verifying the passkey will log the user in. If they're using multifactor authentication, by default this will only authenticate 1st factor, so they'll still need 2nd factor (for pages that require it). However, passkeys are generally considered multi-factor authentication, because the user presents something they "have" (device) and – if user verification took place – something they "are" (biometrics) or "know" (PIN).

We can tell Rodauth to consider user verification as 2nd factor. If there was no user verification, e.g. a security key was used that only requires user presence but doesn't have biometrics or PIN, then only 1st factor will get authenticated.

```rb
# app/misc/rodauth_main.rb
class RodauthMain < Rodauth::Rails::Auth
  configure do
    webauthn_login_user_verification_additional_factor? true
  end
end
```

To make the login UX even better, WebAuthn protocol supports [autofill UI] for passkeys when the email field is focused. Rodauth once again has this built in via the [`webauthn_autofill`][webauthn_autofill] feature (which happens to be a feature I added :blush:):

```rb
# app/misc/rodauth_main.rb
class RodauthMain < Rodauth::Rails::Auth
  configure do
    enable :webauthn_autofill
  end
end
```

When the user opens the login page again and focuses the email field, they should see their passkey being offered. This is because stored passkeys include the user's email address for identification.

<figure>
  <img alt="Autofill UI on email field showing a dropdown with passkeyss" src="/images/rodauth-passkey-autofill.png">
  <figcaption>There is normally a drop shadow, but my Mac's screen capture removed it.</figcaption>
</figure>

When the user selects their passkey and verifies it, they'll be automatically logged in, without even having to type their email address. In fact, they don't even have to select the passkey, they can just scan their fingerprint as soon as they focus the email field.

In addition to passwordless login, Rodauth also supports passwordless registration via the [`webauthn_verify_account`][webauthn_verify_account] feature. The user just needs to enter their email address in the create account form, and when they follow the link in the verification email, they're required to register a passkey in order to verify their account.

## Multiple credentials

Rodauth supports registering multiple passkeys for a single account; the user can just visit the WebAuthn setup page again and create another credential. This is useful for people wanting to register multiple devices for backup.

By default, credentials can only be differentiated by their last used timestamp, which is what's displayed on the WebAuthn remove page by default.

![Rodauth WebAuthn remove page](/images/rodauth-webauthn-remove.png)

Let's add the ability for the user to choose a nickname for their credentials, so that they can more easily differentiate between them. We'll start by adding a new `nickname` column to the `account_webauthn_keys` table:

```sh
$ rails generate migration add_nickname_to_account_webauthn_keys nickname:string
$ rails db:migrate
```
```rb
class AddNicknameToAccountWebauthnKeys < ActiveRecord::Migration
  def change
    add_column :account_webauthn_keys, :nickname, :string
  end
end
```

Next, we'll import the view templates used by the WebAuthn feature, and add a `nickname` field to the setup form:

```sh
$ rails generate rodauth:views webauthn
# create  app/views/rodauth/webauthn_auth.html.erb
# create  app/views/rodauth/webauthn_setup.html.erb
# create  app/views/rodauth/webauthn_remove.html.erb
```
```erb
<!-- app/views/rodauth/webauthn_setup.html.erb -->
<!-- ... -->
  <div class="form-group mb-3">
    <%= form.label :nickname, "Nickname", class: "form-label" %>
    <%= form.text_field :nickname, value: params[:nickname], class: "form-control #{"is-invalid" if rodauth.field_error("nickname")}", aria: ({ invalid: true, describedby: "nickname_error_message" } if rodauth.field_error("nickname")) %>
    <%= content_tag(:span, rodauth.field_error("nickname"), class: "invalid-feedback", id: "nickname_error_message") if rodauth.field_error("nickname") %>
  </div>
<!-- ... -->
```

![Rodauth passkey nickname field](/images/rodauth-passkey-nickname-field.png)

Now we'll hook into the WebAuthn setup request, validate that the `nickname` param was filled in and persist it on the new credential:

```rb
# app/misc/rodauth_main.rb
class RodauthMain < Rodauth::Rails::Auth
  configure do
    before_webauthn_setup do
      throw_error_status(422, "nickname", "must be set") if param("nickname").empty?
    end
    webauthn_key_insert_hash do |credential|
      super(credential).merge(nickname: param("nickname"))
    end
  end
end
```

Finally, let's also modify the remove form to display nicknames instead of last used timestamps (we're using the `Account#webauthn_keys` association defined by [rodauth-model]):

```erb
<!-- app/views/rodauth/webauthn_remove.html.erb -->
<!-- ... -->
  <fieldset class="form-group mb-3">
    <% current_account.webauthn_keys.each do |webauthn_key| %>
      <div class="form-check">
        <%= form.radio_button rodauth.webauthn_remove_param, webauthn_key.webauthn_id, id: "webauthn-remove-#{webauthn_key.webauthn_id}", class: "form-check-input #{"is-invalid" if rodauth.field_error(rodauth.webauthn_remove_param)}", aria: ({ invalid: true, describedby: "webauthn_remove_error_message" } if rodauth.field_error(rodauth.webauthn_remove_param)) %>
        <%= form.label "webauthn-remove-#{webauthn_key.webauthn_id}", webauthn_key.nickname, class: "form-check-label" %>
        <%= content_tag(:span, rodauth.field_error(rodauth.webauthn_remove_param), class: "invalid-feedback", id: "webauthn_remove_error_message") if rodauth.field_error(rodauth.webauthn_remove_param) && webauthn_key == current_account.webauthn_keys.last %>
      </div>
    <% end %>
  </fieldset>
<!-- ... -->
```

![Rodauth passkey remove nicknames](/images/rodauth-passkey-remove-nicknames.png)

## JavaScript side

While the JavaScript for passkey registration & authentication that ships with Rodauth is convenient when getting started, sooner or later you'll probably want to customize it. The original Web Authentication API isn't very user-friendly, but the [@github/webauthn-json] package makes it really simple to use.

The following is the simplest functional implementation using Stimulus:

```js
// app/javascript/controllers/webauthn_controller.js
import { Controller } from "@hotwired/stimulus"
import * as WebAuthnJSON from "@github/webauthn-json"

export default class extends Controller {
  static targets = ["result"]
  static values = { data: Object }

  connect() {
    if (!WebAuthnJSON.supported()) alert("WebAuthn is not supported")
  }

  async setup() {
    const result = await WebAuthnJSON.create({ publicKey: this.dataValue })

    this.resultTarget.value = JSON.stringify(result)
    this.element.requestSubmit()
  }

  async auth() {
    const result = await WebAuthnJSON.get({ publicKey: this.dataValue })

    this.resultTarget.value = JSON.stringify(result)
    this.element.requestSubmit()
  }
}
```
```erb
<!-- app/views/rodauth/webauthn_setup.html.erb -->
<% cred = rodauth.new_webauthn_credential %>

<%= form_with url: request.path, method: :post, data: { controller: "webauthn", webauthn_data_value: cred.as_json.to_json } do |form| %>
  <%= form.hidden_field rodauth.webauthn_setup_param, data: { webauthn_target: "result" } %>
  <%= form.hidden_field rodauth.webauthn_setup_challenge_param, value: cred.challenge %>
  <%= form.hidden_field rodauth.webauthn_setup_challenge_hmac_param, value: rodauth.compute_hmac(cred.challenge) %>

  <% if rodauth.two_factor_modifications_require_password? %>
    <div class="mb-3">
      <%= form.label "password", rodauth.password_label, class: "form-label" %>
      <%= form.password_field rodauth.password_param, autocomplete: rodauth.password_field_autocomplete_value, required: true, class: "form-control #{"is-invalid" if rodauth.field_error(rodauth.password_param)}" %>
      <%= content_tag(:span, rodauth.field_error(rodauth.password_param), class: "invalid-feedback") if rodauth.field_error(rodauth.password_param) %>
    </div>
  <% end %>

  <%= form.submit rodauth.webauthn_setup_button, class: "btn btn-primary", data: { action: "webauthn#setup:prevent" } %>
<% end %>
```
```erb
<!-- app/views/rodauth/webauthn_auth.html.erb -->
<% cred = rodauth.webauthn_credential_options_for_get %>

<%= form_with url: rodauth.webauthn_auth_form_path, method: :post, data: { controller: "webauthn", webauthn_data_value: cred.as_json.to_json } do |form| %>
  <%= form.hidden_field rodauth.webauthn_auth_param, data: { webauthn_target: "result" } %>
  <%= form.hidden_field rodauth.webauthn_auth_challenge_param, value: cred.challenge %>
  <%= form.hidden_field rodauth.webauthn_auth_challenge_hmac_param, value: rodauth.compute_hmac(cred.challenge) %>

  <%= form.hidden_field rodauth.login_param, value: params[rodauth.login_param] if rodauth.valid_login_entered? %>

  <%= form.submit rodauth.webauthn_auth_button, class: "btn btn-primary", data: { action: "webauthn#auth:prevent" } %>
<% end %>
```

The flow works in a way that the server first generates parameters for the Web Authentication API, then when user clicks on the submit button, a JavaScript call is made with those parameters to register/authenticate a passkey on the client device. Once the browser flow is finished, the JavaScript response is submitted with the form, where the server verifies it and handles the outcome (saving passkey information in the database, logging the user in etc).

## Closing words

Passkeys still need wider support in browsers and operating systems before they can become mainstream, but they look very promising. I like that I can use devices I already have, as opposed to having to buy a separate piece of hardware such as a YubiKey. I also feel safer that passkeys are synced automatically, and it's convenient that I don't have to remember on which Apple device I created a passkey for a given website.

The fact that Rodauth provides such advanced support for passkeys with zero configuration shows that it's really keeping up with authentication trends. It also speaks to its incredibly flexible design, as passkeys can be combined with existing authentication methods, acting both as 1st and 2nd factor. The whole flow is highly configurable, as can be seen from the vast list of [configuration methods][webauthn].

## Resources

* [WebAuthn.io](https://webauthn.io/)
* [FIDO Alliance documentation](https://fidoalliance.org/passkeys/)
* [Passkeys.dev](https://passkeys.dev/)
* [Passkeys: What the Heck and Why?](https://css-tricks.com/passkeys-what-the-heck-and-why/) (CSS Tricks)
* [WebAuthn vs Passkeys](https://blog.passwordless.id/webauthn-vs-passkeys) (Passwordless.ID)

[Passkeys]: https://developer.apple.com/passkeys/
[WebAuthn]: https://webauthn.io/
[webauthn-ruby]: https://github.com/cedarcode/webauthn-ruby
[Rodauth]: https://github.com/jeremyevans/rodauth
[autofill UI]: https://passkeys.dev/docs/reference/terms/#autofill-ui
[JavaScript part]: https://github.com/jeremyevans/rodauth/tree/master/javascript
[Web Authentication API]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API
[rodauth-rails]: https://github.com/janko/rodauth-rails
[webauthn]: http://rodauth.jeremyevans.net/rdoc/files/doc/webauthn_rdoc.html
[webauthn_login]: http://rodauth.jeremyevans.net/rdoc/files/doc/webauthn_login_rdoc.html
[autofill UI]: https://passkeys.dev/docs/reference/terms/#autofill-ui
[webauthn_autofill]: http://rodauth.jeremyevans.net/rdoc/files/doc/webauthn_autofill_rdoc.html
[webauthn_verify_account]: http://rodauth.jeremyevans.net/rdoc/files/doc/webauthn_verify_account_rdoc.html
[YubiKey]: https://www.yubico.com/
[mfa article]: https://janko.io/adding-multifactor-authentication-in-rails-with-rodauth/
[rodauth-model]: https://github.com/janko/rodauth-model
[@github/webauthn-json]: https://github.com/github/webauthn-json
