---
layout: post
title: CSS Preprocessing Drama
author: matija
tags: css sass postcss polyfill
---

There has been some talk on the Twitters lately about Sass/PostCSS/cssnext. Hell, even a [CSS-Tricks post](https://css-tricks.com/the-trouble-with-preprocessing-based-on-future-specs/) on the matter. My post will mostly be a reacting to that post.

## Terminology

I think a lot of confusion is focused on terminology, which is pretty silly, it doesn't matter what we call things, as long as we know how and when to use them. In my [previous post](http://twin.github.io/css-pre-vs-post-processing/) (which is kind of outdated) I called PostCSS a **post**-processor, because I wanted to make a difference between Sass and PostCSS. PostCSS can be used for **anything**, you can implement Sass in it if you wanted. But that's not how I believe it should be used. I think it should be used for processing already valid CSS, that's why I called it a postprocessor.

If you invent your own CSS abstraction language, not only will you break syntax highlighting (which, as silly as it sounds, is a good enough reason), you will also make it difficult for others to work on your code. Sass is an established language, it has a [spec][sass-spec], and it's not like Babel, it's more like CoffeeScript. CoffeeScript is not what JavaScript will look like in the future, it's just syntactic sugar and polyfills. The fact that CoffeeScript and ES2015 share the fat arrow (=>) doesn't make a difference.

My question to you is, why is Babel good and cssnext bad? Don't they do pretty much the same thing? In Babel there are experimental features from specs that can change, but you can still use them.

## Preprocessing Future Syntaxes

It's important to state that just because cssnext's usefulness is questionable (lot of new CSS features cannot be polyfilled), doesn't make it true for JS. Babel works great, it has plugins for everything and an amazing community, which in itself tells us that it's obviously working. [This comment](https://css-tricks.com/the-trouble-with-preprocessing-based-on-future-specs/#comment-1595970) explains it nicely.

So just to focus, this is really a conversation about cssnext.

## Sass As a Temporary Solution

A lot of Sass features are solutions to shortcomings of CSS. The parent selector is used pretty much only for namespacing, because Web Components still aren't here.

I think we should all be writing as [little Sass as possible](http://www.sitepoint.com/keep-sass-simple/).

## cssnext vs PostCSS

cssnext is a collection of PostCSS plugins. PostCSS has never stated that it's all about transpiling future syntaxes, so we shouldn't pin it on PostCSS. The good parts of cssnext is something similar to what Autoprefixer is, you can drop it when the feature is well supported (e.g. filters). I agree that cssnext should be used more carefully, but it doesn't make it a bad idea, I just don't think that you can significantly benefit from it. We mostly crave for features which gives us power we didn't have. Like selecting a parent.

I think PostCSS should be used sparingly and only when it really makes sense. For example, it makes much more sense to use a PostCSS plugin for IE 8 `opacity` fallback than a Sass mixin.

```css
.foo {
  opacity: 0.5;
}
```

```scss
.foo {
  @include opacity(0.5);
}
```

The difference is in having to **know** that IE 8 doesn't understand `opacity`, which is pointless, you should spend your memory on more useful things.

So, this is a minimalistic example where PostCSS is clearly a better choice. PostCSS squeezed what didn't belong out of Sass.

[This comment](https://css-tricks.com/the-trouble-with-preprocessing-based-on-future-specs/#comment-1595997) from the creator of cssnext explains it very well.

## Compass

Just to clarify, joining icons into a spritesheet is not Sass. If you check the [docs](http://sass-lang.com/documentation/file.SASS_REFERENCE.html), you'll see that it claims to be able to do no such thing. It's all Compass, more specifically, it's Ruby. Ruby is the one doing the processing.

And you shouldn't be using Compass just because of CSS sprites, it's really slow (although it's getting a libsass makeover). Try rather to integrate [sprity] into your workflow and `@import` the output stylesheet.

## Will PostCSS replace Sass?

I don't think so. They do have an overlap, but PostCSS is better suited for fallbacks and Sass for control flow, nesting etc.

[postcss]: https://github.com/postcss/postcss
[sass-spec]: https://github.com/sass/sass-spec
[sprity]: https://www.npmjs.com/package/sprity
