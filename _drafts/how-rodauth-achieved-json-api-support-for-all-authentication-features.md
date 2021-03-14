---
title: How Rodauth Achieved JSON API Support for All Authentication Features
tags: rodauth
---

If you've ever implemented authentication in a Ruby/Rails app that provides a
JSON API, you might have noticed that popular Rails-based authentication
frameworks haven't exactly standardized JSON API support for the authentication
operations they provide:

* **Devise** – there are [Devise Token Auth][devise_token_auth], [Devise::JWT][devise-jwt], and [Simple Token Authentication][simple_token_authentication]
* **Sorcery** – planned for 1.0, with a few [open][sorcery#239] [pull][sorcery#167] [requests][sorcery#70]
* **Clearance** – the authors [don't plan on supporting JSON API at this time][clearance json]

It's possible to reuse lower-level functionality from these frameworks to
implement JSON API support. In fact, this is what Devise Token Auth and
Simple Token Authentication gems have done.

TODO:

* spomenut api_guard, knock, i Doorkeeper

We'll be working with this simplified implementation of login operation:

```rb
# /login
route do |r|
  # GET /login
  r.get do
    view(:login)
  end

  # POST /login
  r.post do
    catch_error do
      unless account_from_login(param("email"))
        throw_error_status(401, "email", "no account with this email address")
      end

      unless open_account?
        throw_error_status(403, "email", "unverified account, please verify account before logging in")
      end

      unless password_match?(param("password"))
        throw_error_status(401, "password", "invalid password")
      end

      set_session_value(:account_id, account_id)
      set_notice_flash "You have been logged in"
      redirect "/"
    end

    set_error_flash "There was an error logging in"
    view(:login)
  end
end
```

## JSON

## JWT

[Rodauth]: https://github.com/jeremyevans/rodauth
[devise_token_auth]: https://github.com/lynndylanhurley/devise_token_auth
[devise-jwt]: https://github.com/waiting-for-dev/devise-jwt
[simple_token_authentication]: https://github.com/gonzalo-bulnes/simple_token_authentication
[sorcery#239]: https://github.com/Sorcery/sorcery/pull/239
[sorcery#167]: https://github.com/Sorcery/sorcery/pull/167
[sorcery#70]: https://github.com/Sorcery/sorcery/pull/70
[clearance json]: https://github.com/thoughtbot/clearance/issues/896
