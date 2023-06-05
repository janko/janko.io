---
title: Upgrading from Selenium to Cuprite
---

When I joined my current company, the system tests for our Rails app used Selenium as the Capybara driver. I didn't have good experiences with Selenium in the past, mostly it was tedious to have to keep chromedriver up-to-date with the auto-updating Chrome. In this project, I was frequently hitting maximum number of open file descriptors on my OS when running system tests, probably in combination with Spring. We're using the [Webdrivers] gem, and we also needed to ignore its download URLs in VCR and WebMock. But my primary issue was that the system tests just seemed kind of slow in general.

I stumbled across [an episode of The Bike Shed podcast](https://www.bikeshed.fm/355), where it was mentioned that Selenium can add considerable overhead, so I decided it was worth trying out [Cuprite]. For those not familiar, Cuprite is a Capybara driver that interacts with Chrome directly using [CDP] (Chrome DevTools Protocol). This is in contrast to Selenium, which goes through chromedriver/geckodriver command-line tool.

I have to say I did not expect the performance improvements to be so significant. Running individual system tests was about 30-50% faster on my M1 MacBook Air, while our overall system test suite went **from 9 minutes to 6 minutes**, which is a **30% speedup**. Just from changing the Capybara driver. For someone who cares about fast tests, this was a considerable win :metal:

Our Capybara configuration ended up being the following:

```rb
require 'capybara/rspec'
require 'capybara/cuprite'

Capybara.default_max_wait_time = 5
Capybara.disable_animation = true

RSpec.configure do |config|
  config.before(:each, type: :system) do
    driven_by(:cuprite, screen_size: [1440, 810], options: {
      js_errors: true,
      headless: %w[0 false].exclude?(ENV["HEADLESS"]),
      slowmo: ENV["SLOWMO"]&.to_f,
      process_timeout: 15,
      timeout: 10,
      browser_options: ENV["DOCKER"] ? { "no-sandbox" => nil } : {}
    })
  end

  config.filter_gems_from_backtrace("capybara", "cuprite", "ferrum")
end
```

## Flaky test failures

While moving to Cuprite made tests faster, we started getting dozens of new flaky test failures. After looking at them more closely, I found that each failure was caused by improper waiting for JavaScript (we're using Hotwire). With Selenium, those issues were just masked, because the overhead was big enough that the race conditions never manifested.

Most failures were around clicking on a link and then waiting for text to appear, but that text was already present on the previous page, so Capybara didn't actually wait for the new page to get navigated to. In some cases we needed to manually scroll to elements before interacting with them, where Selenium appears to have automatically scrolled.

```rb
click_on "Some link"
# make sure this text was NOT present on the previous page
expect(page).to have_content("Some text")
```

### Disabling CSS transitions

We're using Bootstrap, and I noticed that some modal clicks were failing. It turned out that due to CSS transitions used by Bootstrap modals, Capybara would sometimes attempt to click on a moving target. Since we don't actually need animations in tests, I was looking for a way to disable them. By sheer luck I discovered a handy Capybara configuration that takes care of this:

```rb
# disable CSS transitions and jQuery animations
Capybara.disable_animation = true
```

One problem is that our flash messages are set to fade away after 3 seconds, so this caused them not to disappear automatically. This was fine most of the time, but in some cases they were covering content we needed to interact with. To address this, I created a helper method that retrieves the flash message and immediatelly closes the alert:

```rb
def flash_message
  message = find(".flash").text.split("\n").last
  find(".flash .close").click # close alert
  message
end
```
```rb
# ...
click_on "Create Device"
expect(flash_message).to eq "Device was successfully created"
```

### Disabling Turbo previews

In a previous project, I found that [Turbo previews] were the cause of one flaky test, so I disabled them by adding the following into `<head>` of the layout:

```html
<!-- disable cached Turbo previews when navigating -->
<meta name="turbo-cache-control" content="no-preview">
``` 

## Raising Stimulus errors

When a JavaScript errors occur inside Stimulus lifecycle callbacks or actions, they are [caught][stimulus error handling] by Stimulus and logged. This avoids an error from one Stimulus controller halting JavaScript execution and preventing other Stimulus controllers from being executed (see [Sam Stephenson's explanation][sam explanation] for more details).

While this is useful for production, in tests we want to get alerted when JavaScript errors occur. After configuring Cuprite to convert any JS errors into Ruby exceptions by setting `js_errors: true`, we overrode Stimulus application's error handler in tests to propagate errors:

```js
import { Application } from "@hotwired/stimulus"

const application = Application.start()

// Works with Webpacker (in Vite we'd use `import.meta.env.MODE === "test"`).
if (process.env.RAILS_ENV === "test") {
  // propagate errors that happen inside Stimulus controllers
  application.handleError = (error, message, detail) => {
    throw error
  }
}
```

## Precompiling assets

We were initially hitting timeout errors on CI from Cuprite on the first test. The reason was that Webpacker would compile assets on the first request. We tried increasing `:process_timeout` in Cuprite, but that didn't help.

Instead of letting Webpacker compile assets on-the-fly, we chose to precompile them in advance, which fixed the issue.

```sh
$ bundle exec rake assets:precompile
$ bundle exec rspec spec/system
```

However, when JS errors would occur, I noticed the JavaScript source was now minified. This not only made it more difficult to locate where the error occurred, but on CI the error message was completely absent. This is because the `webpack:compile` rake task [defaults][webpack compile] `NODE_ENV` to `production`. First I tried setting `NODE_ENV=test`, but that didn't skip minification, and I later found out this is intended for JavaScript tests. Setting `NODE_ENV=development` on CI worked, which is what's used for on-the-fly compilation.

I would prefer Webpacker not to merge assets into a single file in tests, but I think migrating to [Vite] would help with this.

## Toggling headless mode

Cuprite runs Chrome in so-called "headless" mode by default, which means the browser doesn't open up while tests are being run. However, if you're debugging a failing test, it's not always enough to look at the captured screenshots, sometimes you need to *see* what's happening on the page.

Our Cuprite configuration allowed us to pass `HEADLESS=0` environment variable to the `rspec` command to disable headless mode. If the interaction was happening too fast to make sense of anything, we could additionally set e.g. `SLOWMO=0.5` to add 0.5s of overhead to every click.

```sh
$ HEADLESS=0 SLOWMO=0.5 bin/rspec spec/system/something_spec.rb
```

## Docker handling

Some team members prefer to run the Rails app locally through Docker. To make Cuprite work, we set `DOCKER=true` in our `docker-compose.yml`, and then based on that environment variable passed the `no-sandbox` option to Chrome.

## Closing words

The performance benefits alone will definitely make me advocate for using Cuprite every time. The only feature I found it doesn't support yet is drag-and-drop, though [initial support](https://github.com/rubycdp/cuprite/pull/176) has been merged to master.

Flaky test failures have always been a challenge for me when writing system tests. What helped me is to trust that the root cause is always figureoutable. I would previously attribute them to complex Selenium internals, but Cuprite is much less magical in comparison, so I can make better sense of why something is happening.

[Webdrivers]: https://github.com/ttusfortner/webdrivers
[Cuprite]: https://github.com/rubycdp/cuprite
[CDP]: https://chromedevtools.github.io/devtools-protocol/
[stimulus error handling]: https://stimulus.hotwired.dev/handbook/installing#error-handling
[sam explanation]: https://github.com/hotwired/stimulus/issues/236#issuecomment-479694545
[Turbo previews]: https://turbo.hotwired.dev/handbook/building#opting-out-of-caching
[webpack compile]: https://github.com/rails/webpacker/blob/3fd96bcbf495db5a24a46606465e9837fec232c1/lib/tasks/webpacker/compile.rake#L23
[Vite]: https://vite-ruby.netlify.app/
