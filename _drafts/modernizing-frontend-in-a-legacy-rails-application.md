---
title: Modernizing Frontend in a Legacy Rails Application
---

At my [current company](https://butterflymx.com), our central admin interface is a 10+ year old Rails app. A lot has changed over that time in the frontend scene. When I joined the company over 3 years ago, we already started moving to Hotwire, but the majority of the frontend code was still stuck in the old days.

New JavaScript code was written in Stimulus under Webpacker, but most was still spaghetti jQuery managed by Sprockets, alongside CSS (Sass) and images. By that point, Webpacker had already started falling out of fashion. With Rails 7 came new simpler integrations for node bundlers (`jsbundling-rails`, `cssbundling-rails`), Node-free pipelines (`tailwindcss-rails`, `dartsass-rails`) as well as #nobuild solutions (`importmap-rails`).

We had a lot of legacy Sass code that we couldn't easily rewrite into modern CSS. We also had older jQuery and Selectize versions deeply ingrained, which aren't ESM-compatible. Additionally, I wanted to add Tailwind CSS into the mix, but still keep our legacy Sass around.

These requirements put [Vite Ruby](https://github.com/ElMassimo/vite_ruby) on my radar. Its promises of blazing-fast compilation, a single pipeline for JS, CSS and images, but most importantly native support for multiple CSS processors (Sass, PostCSS, Tailwind) and both ESM and UMD (jQuery, Selectize) imports, have won me over as the legacy-friendly successor to Webpacker.

## Sprockets to Webpacker migration

I decided to delay the decision to migrate to Vite, so that we can first complete the migration from Sprockets to Webpacker. I saw going from Webpacker to Vite as a significantly smaller step, and I wanted to buy time for my team to align on Vite.

This primarily involved porting spaghetti jQuery code into organized Stimulus controllers and replacing the remaining JS/CSS dependencies we still had wrapped in Ruby gems with Node packages.

| Ruby Gem                                                         |              | NPM package                        |
| :--------                                                        | :----------- | :-------------                     |
| `sass-rails`                                                     | →            | `sass`                             |
| `bootstrap-sass`                                                 | →            | `bootstrap`                        |
| `jquery-rails`                                                   | →            | `jquery`                           |
| `selectize-rails`                                                | →            | `selectize`                        |
| `font-awesome-sass`                                              | →            | `font-awesome`                     |
| `momentjs-rails` + `moment_timezone-rails`                       | →            | `date-fns`                         |
| `bootstrap3-datetimepicker-rails`,<br> `jquery-timepicker-rails` | →            | `flatpickr` + `stimulus-flatpickr` |
| `uglifier`, `terser`                                             | →            | built in                           |

Replacing the `bootstrap-sass` gem with plain CSS import from the `bootstrap` package reduced our coupling to Sass, making it easier to replace later. Swapping the deprecated Moment.js for `date-fns` reduced our bundle size, while consolidating on Flatpickr for date/time pickers simplified our UI and improved consistency.

At this point, we had our frontend entirely migrated from Sprockets in `app/assets` to Webpacker in `app/javascript`, allowing us to **finally drop Sprockets**. We later added in Propshaft for gems that require an asset pipeline for their internal dashboards (like [Maintenance Tasks](https://github.com/Shopify/maintenance_tasks)).

## Going from Webpacker to Vite

My next goal was to introduce Tailwind CSS, which at that time depended on PostCSS. However, Webpacker 5.x didn't support PostCSS 8 required by newer Tailwind 3.x versions. I considered temporarily moving to Shakapacker, but even my attempts to upgrade to latest Webpacker 5.x failed miserably. So, I decided keeping Webpacker wasn't worth it anymore, and that it was time to migrate to Vite.

I installed [`vite_rails`](https://vite-ruby.netlify.app/guide/rails.html#tag-helpers-%F0%9F%8F%B7) gem and [`vite-plugin-rails`](https://vite-ruby.netlify.app/guide/plugins.html#rails) Vite plugin. I also moved frontend code from `app/javascript` to the more accurate `app/frontend` (inspired by [Evil Martians](https://evilmartians.com/chronicles/evil-front-part-1)), extracted CSS imports into a dedicated `*.css` entrypoint to avoid FOUC in development, and replaced `@hotwired/stimulus-webpack-helpers` with [`stimulus-vite-helpers`](https://www.npmjs.com/package/stimulus-vite-helpers) for auto-registering Stimulus controllers.

```diff
 import { Application } from "stimulus"
-import { definitionsFromContext } from "stimulus/webpack-helpers"
+import { registerControllers } from "stimulus-vite-helpers"
 import Autosave from "stimulus-rails-autosave"
 import CharacterCounter from "stimulus-character-counter"
 import TextareaAutogrow from "stimulus-textarea-autogrow"
 import env from "../../shared/env"
 
 window.Stimulus = Application.start()
-const context = require.context(".", true, /_controller\.js$/)
-Stimulus.load(definitionsFromContext(context))
+const controllers = import.meta.glob("./**/*_controller.js", { eager: true })
+registerControllers(Stimulus, controllers)
```

To keep jQuery loaded globally (Bootstrap/Selectize requirement), I just needed to extract the setup into its own file.

```js
// app/frontend/entrypoints/admin.js
import "../initializers/jquery.js"
```
```js
// app/frontend/initializers/jquery.js
import jQuery from "jquery"
Object.assign(window, { $: jQuery, jQuery })
```

The remainder of the work was mostly just replacing `*_pack_tag` helpers with `vite_*_tag` counterparts in views. For the `inline_svg` gem, we needed to add a [manual Vite compatibility layer](https://mattbrictson.com/blog/inline-svg-with-vite-rails).

Removing Webpack, PostCSS/cssnano and Babel from our dependencies reduced our `yarn.lock` **by 60%**. We received livereload for CSS, HMR for Stimulus, and full-page reload for view edits – all with a much simpler configuration file (Webpacker's internal Webpack config was a monstrosity :sweat_smile:):

```js
// vite.config.mjs
import { defineConfig } from "vite"
import rails from "vite-plugin-rails"

export default defineConfig(({ mode }) => {
  return {
    plugins: [
      rails({
        compress: false // avoid build time overhead
      })
    ],
    resolve: {
      alias: {
        stimulus: "@hotwired/stimulus" // handle legacy Stimulus components
      }
    },
    css: {
      devSourcemap: true // see CSS sources in development
    },
    build: {
      minify: mode == "production" // skip minification in tests
    },
    clearScreen: false // play nice with Foreman
  }
})
```

Dev server cold start went **from 4s to 0.2s** with Vite's lazy bundling, while asset compilation went **from 8s to 3.7s**, and then later **down to 1 second** with Vite 8.

In short, we got wins on all fronts :metal:

## Bringing in Tailwind

Now that we were on Vite, it was time to add Tailwind into the mix. I wanted Tailwind because it provides a design framework, I can style things much more rapidly, I don't need to keep reinventing new CSS classes, and I can remove HTML without leaving dead CSS code behind.

```sh
$ yarn add tailwindcss @tailwindcss/vite
```
```diff
  // vite.config.mjs
  import { defineConfig } from "vite"
  import rails from "vite-plugin-rails"
+ import tailwind from "@tailwindcss/vite"

  export default defineConfig(({ mode }) => {
    return {
      plugins: [
+       tailwind(),
        rails({
          compress: false
        })
      ],
      // ...  
    }
  }
```

Tailwind v4 uses cascade layers (`theme`, `base`, `components` and `utilities`), so we put our existing CSS into the `components` layer, in order for `utilities` layer to have precedence. Additionally, while Tailwind v3 could be mixed with Sass (presumably because PostCSS supported it), version 4.x dropped this support after moving to Lightning CSS. We worked around this by going with two Vite entrypoints for CSS, one for Sass and one for Tailwind:

```css
/* app/frontend/entrypoints/admin.css (Tailwind) */
@import "tailwindcss";
@plugin "@tailwindcss/forms";
@source "../../{views,helpers,decorators}/**/*";

@theme {
  /* ... */
}

@import "bootstrap/dist/css/bootstrap.css" layer(components);
@import "trix/dist/trix.css" layer(components);
@import "flatpickr/dist/flatpickr.css" layer(components);
/* ... */
```
```css
/* app/frontend/entrypoints/admin.scss (Sass) */
@layer components {
  @import "../stylesheets/admin.scss"; /* our Sass code */
}
```

We could now replace many of our utility classes that had direct Tailwind equivalents. We were still on Bootstrap 3, but had manually generated margin/padding utilities that Bootstrap 4+ has, which we now replaced with Tailwind ones. The only real clash was the `.hidden` utility, which Bootstrap declares with `!important`, breaking Tailwind idioms like `hidden md:block`. I fixed this by patching Bootstrap's source CSS file:

```sh
$ yarn add --dev patch-package postinstall-postinstall
```
```js
// package.json
{
  // ...
  "scripts": {
    "postinstall": "patch-package"
  }
}
```
```diff
// patches/bootstrap+3.4.1.patch
diff --git a/node_modules/bootstrap/dist/css/bootstrap.css b/node_modules/bootstrap/dist/css/bootstrap.css
index fcab415..08f5600 100644
--- a/node_modules/bootstrap/dist/css/bootstrap.css
+++ b/node_modules/bootstrap/dist/css/bootstrap.css
@@ -6615,9 +6615,6 @@ button.close {
   background-color: transparent;
   border: 0;
 }
-.hidden {
-  display: none !important;
-}
 .affix {
   position: fixed;
 }
```

## Eliminating Sass

## Adopting Herb
