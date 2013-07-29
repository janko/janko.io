---
layout: post
title: "Speedy Sass with @import & Sprockets"
author: matija
---

We learned that it's not possible to properly use [Sprockets][sprockets] with Sass because access to global variables, mixins and functions (let's call them **globals**) would be lost. Only `@import`ing them works. If you, like me, really love designing in the browser (maybe using [LiveReload][live-reload] or something similar), you are probably having a hard time dealing with the slow compilation time on larger projects, because it's killing your creativity. I would like to propose a way to bring Sprockets back to the game.

## Rails **and** non-Rails projects

Just to be clear, Sprockets are *not* limited to Rails, Rails just has them built-in. For example, if you're using [Guard][guard] in your project, you can easily implement Sprockets using [guard-sprockets][guard-sprockets].

## The @import way

To spice things up, we're going to use [Twitter Bootstrap][bootstrap] and [Bourbon][bourbon] in this example. Assuming we're in Rails, we can use the [bootstrap-sass-rails][bootstrap-sass-rails] gem for Bootstrap, I think that's the best one.

Your main stylesheet might look something like this:

```scss
// The configuration for Bootstrap.
@import "config/bootstrap";

// Bootstrap.
@import "twitter/bootstrap";

// Bourbon, a minimal, modern set of variables, mixins and functions. I use it instead of Compass.
@import "bourbon";

// Variables, mixins and functions concerning your site. The order matters, we included Bourbon and these stylesheets after Bootstrap so Bootstrap doesn't override our stuff (for example, Bourbon's "size" mixin).
@import "variables";
@import "mixins";
@import "functions";

// General styles, containing mostly element selectors.
@import "base";
@import "typography";
@import "forms";

// Individual modules, containing mostly class selectors.
@import "login";
@import "list-fancy";
// ...
```

From the compilation's point of view, this means that every time you change any of the imported stylesheets, other stylesheets will have to recompile too, even though they have not changed, which can several seconds, depending on the amount of styles. This is because when stylesheets are imported, they become **partials**, they aren't treated as individual stylesheets anymore. From now on, I'll use that term (*partial*) when referring to imported stylesheets.

## The Sprockets way

Sprockets do something different. They compile each stylesheet individually and only stylesheets that have changed get recompiled.

Our first attempt at implementing Sprockets into our project might look something like this:

```scss
//= require config/bootstrap
//= require twitter/bootstrap

//= require bourbon

//= require variables
//= require mixins
//= require functions

//= require base
//= require typography
//= require forms

//= require login
//= require list-fancy
// ...
```

This would be great! ...if it worked. Because these stylesheets are compiled individually, they don't have access to the globals and the compilation will fail.

It sucks, but it won't stop us from achieving the fast compilation we so desperately want!

When using Sprockets, we can't have globals, so we will have to import them at the top of each stylesheet. We could import each global stylesheet individually, depending an what we need, but maintaining those imports would be hard and result in very small speed gain. What I like to do is create a partial and import all global stylesheets there, then import that partial at the top of each stylesheet. We'll creatively name the partial "import-me" :

```scss
@import "config/bootstrap";
@import "twitter/bootstrap/variables";
@import "twitter/bootstrap/mixins";
@import "bourbon";
@import "variables";
@import "mixins";
@import "functions";
```

And we're done! All we have to do now is import `import-me` on top of each stylesheet:

```scss
@import "import-me"

// the rest of the stylesheet...
```

Some stylesheets perhaps aren't going to need the globals, but I like to include them everywhere so I don't have to think too much. It doesn't really matter, the compilation time will be tiny anyway. The important thing is that we can now safely use Sprockets! Also, now we don't have to require those globals because we already imported them into each stylesheet.

Ready? Let's do it!

```scss
//= require base
//= require typography
//= require forms

//= require login
//= require list-fancy
// ...
```

Your (re)compilation time should now remind you of Speedy Gonzales.

## Conclusion

This solution may feel somewhat hacky at the beginning, but I think the gain is really worth it.

I haven't seen anyone using something like this or even talking about it. Are you using a similar approach? Is there a better way to do this? Let me know in the comments! :)

[sprockets]:            //github.com/sstephenson/sprockets
[live-reload]:          http://livereload.com
[guard]:                //github.com/guard/guard
[guard-sprockets]:      //github.com/pferdefleisch/guard-sprockets
[bootstrap]:            //twitter.github.io/bootstrap/
[bootstrap-sass-rails]: //github.com/yabawock/bootstrap-sass-rails
[bourbon]:              http://bourbon.io/
