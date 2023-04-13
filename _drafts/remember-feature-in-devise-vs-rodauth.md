---
title: Diving into Remember Me in Devise and Rodauth
tags: rodauth
---

I was working on some improvements for the [remember] Rodauth feature, and wanted to look into the implementation of Devise's [rememberable] module for inspiration. However, I generally find it difficult to follow Devise's source code, due to the execution jumping between many different contexts (controllers, models, strategies, hooks).

So, I wanted to take you through one of these dives, where we follow the execution from storing the remember token to loading the user from the token. We'll gain a better understanding of how this feature works, and get a closer look at the internals of these two authentication frameworks.

## Devise

In Devise, the rememerable flow starts when the user checks the "remember me" checkbox on login. On form submit, this value gets written into the `remember_me` attribute accessor on the model, defined by the `Devise::Models::Rememerable` mixin.

```rb
# lib/devise/models/rememerable.rb
module Devise::Models::Rememerable
  attr_accessor :remember_me
end
```

When the user gets signed in, a Warden hook then reads the `remember_me` attribute value, and calls `#remember_me` on a `Devise::Hooks::Proxy` instance.

```rb
# lib/devise/hooks/rememberable.rb
Warden::Manager.after_set_user except: :fetch do |record, warden, options|
  scope = options[:scope]
  if record.respond_to?(:remember_me) && options[:store] != false &&
     record.remember_me && warden.authenticated?(scope)
    Devise::Hooks::Proxy.new(warden).remember_me(record)
  end
end
```

This `#remember_me` method comes from the `Devise::Controllers::Rememerable` module that's mixed into `Devise::Hooks::Proxy`.

```rb
# lib/devise/controllers/rememerable.rb
module Devise::Controllers::Rememberable
  def remember_me(resource)
    return if request.env["devise.skip_storage"]
    scope = Devise::Mapping.find_scope!(resource)
    resource.remember_me!
    cookies.signed[remember_key(resource, scope)] = remember_cookie_values(resource)
  end

  protected

  def remember_cookie_values(resource)
    options = { httponly: true }
    options.merge!(forget_cookie_values(resource))
    options.merge!(
      value: resource.class.serialize_into_cookie(resource),
      expires: resource.remember_expires_at
    )
  end

  def forget_cookie_values(resource)
    Devise::Controllers::Rememberable.cookie_values.merge!(resource.rememberable_options)
  end
end
```

It proceeds to call `#remember_me!` on the model, defined back in the `Devise::Models::Rememerable` mixin, which generates and persists the remember token along with its creation time. Afterwards, it stores the record ID, remember token, and current timestamp into a cookie.

```rb
# lib/devise/models/rememerable.rb
module Devise::Models::Rememberable
  def remember_me!
    self.remember_token ||= self.class.remember_token if respond_to?(:remember_token)
    self.remember_created_at ||= Time.now.utc
    save(validate: false) if self.changed?
  end

  module ClassMethods
    def serialize_into_cookie(record)
      [record.to_key, record.remember_token, Time.now.utc.to_f.to_s]
    end

    def remember_token
      loop do
        token = Devise.friendly_token
        break token unless to_adapter.find_first({ remember_token: token })
      end
    end
  end
end
```

When authenticating a request, `Devises::Strategies::Rememerable` will load the user from the remember cookie, optionally extend the remember period, and then consider the authentication successful.

```rb
# lib/devise/strategies/rememberable.rb
class Devise::Strategies::Rememberable < Devise::Strategies::Authenticatable
  def authenticate!
    resource = mapping.to.serialize_from_cookie(*remember_cookie)

    unless resource
      cookies.delete(remember_key)
      return pass
    end

    if validate(resource)
      remember_me(resource) if extend_remember_me?(resource)
      resource.after_remembered
      success!(resource)
    end
  end

  private

  def remember_cookie
    @remember_cookie ||= cookies.signed[remember_key]
  end
end
```

The `serialize_from_cookie` method retrieves the user by record ID, checks that the remember period hasn't expired, and ensures the remember token from the cookie matches the one in the database.

```rb
# lib/devise/models/rememberable.rb
module Devise::Models::Rememberable
  module ClassMethods
    def serialize_from_cookie(*args)
      id, token, generated_at = *args

      record = to_adapter.get(id)
      record if record && record.remember_me?(token, generated_at)
    end
  end

  def remember_me?(token, generated_at)
    if generated_at.is_a?(String)
      generated_at = time_from_json(generated_at)
    end

    generated_at.is_a?(Time) &&
      (self.class.remember_for.ago < generated_at) &&
      (generated_at > (remember_created_at || Time.now).utc) &&
      Devise.secure_compare(rememberable_value, token)
  end
end
```

The execution flow can be summarized as follows:

| Action | File |
| ------ | ---- |
| set remember attribute on login | `lib/devise/models/rememberable.rb` |
| get remember attribute after signin | `lib/devise/hooks/rememberable.rb` |
| persist remember token in the table | `lib/devise/models/rememberable.rb` |
| save remember token in the cookie | `lib/devise/controllers/rememberable.rb` |
| read remember cookie on authentication | `lib/devise/strategies/rememberable.rb` |
| load user from remember cookie | `lib/devise/models/rememberable.rb` |

## Rodauth

In Rodauth, a remember cookie is created for an account by calling `remember_login` on the Rodauth instance after login, which is defined in the `Rodauth::Remember` mixin.

```rb
# lib/rodauth/features/remember.rb
Rodauth::Feature.define(:Remember) do
  def remember_login
    get_remember_key
    set_remember_cookie
    set_session_value(remember_deadline_extended_session_key, Time.now.to_i) if extend_remember_deadline?
  end

  private

  def set_remember_cookie
    opts = Hash[remember_cookie_options]
    opts[:value] = "#{account_id}_#{convert_token_key(remember_key_value)}"
    opts[:expires] = convert_timestamp(active_remember_key_ds.get(remember_deadline_column))
    opts[:path] = "/" unless opts.key?(:path)
    opts[:httponly] = true unless opts.key?(:httponly) || opts.key?(:http_only)
    opts[:secure] = true unless opts.key?(:secure) || !request.ssl?
    ::Rack::Utils.set_cookie_header!(response.headers, remember_cookie_key, opts)
  end
end
```

The method retrieves the remember key, sets the remember cookie with the token, and stores that it has extended the remember period. Let's look at the `get_remember_key` method:

```rb
# lib/rodauth/features/remember.rb
Rodauth::Feature.define(:remember) do
  def get_remember_key
    unless @remember_key_value = active_remember_key_ds.get(remember_key_column)
      generate_remember_key_value
      transaction do
        remove_remember_key
        add_remember_key
      end
    end
    nil
  end

  def add_remember_key
    hash = {remember_id_column=>account_id, remember_key_column=>remember_key_value}
    set_deadline_value(hash, remember_deadline_column, remember_deadline_interval)

    if e = raised_uniqueness_violation{remember_key_ds.insert(hash)}
      raise e unless @remember_key_value = active_remember_key_ds.get(remember_key_column)
    end
  end

  def remove_remember_key(id=account_id)
    remember_key_ds(id).delete
  end

  private

  def generate_remember_key_value
    @remember_key_value = random_key
  end
end
```

This method tries to retrieve an existing remember key, and if it doesn't exist or has expired, it generates a new one and persists it, deleting an expired remember key.

To load the user from the remember cookie, we call `load_memory` on the Rodauth object at the beginning of each request.

```rb
# lib/rodauth/features/remember.rb
Rodauth::Feature.define(:Remember) do
  def load_memory
    if logged_in?
      if extend_remember_deadline_while_logged_in?
        account_from_session
        extend_remember_deadline
      end
    elsif account_from_remember_cookie
      before_load_memory
      login_session('remember')
      extend_remember_deadline if extend_remember_deadline?
      after_load_memory
    end
  end
end
```

If the session is logged in, the remember deadline is extended for the account if needed. Otherwise, the account is loaded from the remember cookie, logged into the session, and its remember deadline is optionally extended. Let's look at the `account_from_remember_cookie` method:

```rb
# lib/rodauth/features/remember.rb
Rodauth::Feature.define(:remember) do
  def account_from_remember_cookie
    unless id = remembered_session_id
      forget_login if _get_remember_cookie
      return
    end

    set_session_value(session_key, id)
    account_from_session
    remove_session_value(session_key)

    unless account
      remove_remember_key(id)
      forget_login
      return
    end

    account
  end

  def remembered_session_id
    return unless cookie = _get_remember_cookie
    id, key = cookie.split('_', 2)
    return unless id && key

    actual, deadline = active_remember_key_ds(id).get([remember_key_column, remember_deadline_column])
    return unless actual

    if hmac_secret
      unless valid = timing_safe_eql?(key, compute_hmac(actual))
        unless raw_remember_token_deadline && raw_remember_token_deadline > convert_timestamp(deadline)
          return
        end
      end
    end

    unless valid || timing_safe_eql?(key, actual)
      return
    end

    id
  end

  def _get_remember_cookie
    request.cookies[remember_cookie_key]
  end
end
```

There is a bit more going on here, but essentially the account ID and remember token are retrieved from the remember cookie, then the token value is compared with the one in the database along with its expiration time, and finally the account record is loaded from the ID. 

To recap, the execution flow is roughly as follows:

| Action | File |
| ------ | ---- |
| choose to remember after login | `lib/rodauth/features/remember.rb` |
| persist remember token in the table | `lib/rodauth/features/remember.rb` |
| save remember token in the cookie | `lib/rodauth/features/remember.rb` |
| read remember cookie before request | `lib/rodauth/features/remember.rb` |
| load account from remember cookie | `lib/rodauth/features/remember.rb` |

[remember]: http://rodauth.jeremyevans.net/rdoc/files/doc/remember_rdoc.html
[rememberable]: https://www.rubydoc.info/github/heartcombo/devise/main/Devise/Models/Rememberable
