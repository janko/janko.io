---
title: Short & Sweet Intro to Webpack
author: matija
tags: webpack package module bundler dependency require
---

If you're a frontend developer, webpack might be coming up very often lately. In the React community you might feel even pressured to use it. You might even angrily exclaim "oh great, yet another tool to learn?!" First of all, welcome to frontend development :wink: second, webpack is much more than just another tool. It will enable you to build a dependency tree out of your web application.

## Use Cases

I recommend using webpack only for SPAs. Presentation websites might not benefit much from it because they usually don't have a single point of entry, so things may get awkward. In those cases I suggest something like [Gulp] or [Brunch].

## Dependency Tree

Everything is a dependency. Your home view depends on a carousel component, which depends on some images. With webpack you can easily describe this:

```js
// index.js
import './home';
```

```js
// home.js
import carousel from './carousel';
carousel.initialize();
```

```js
// carousel.js
import image1 from './image1.jpg';
import image2 from './image2.jpg';
import image3 from './image3.jpg';

export default {
  initialize() {
    // create a carousel with image1, image2 and image3
  }
};
```

The benefits of splitting your app into tiny modules and building a dependency tree:

  - you will never have to worry about source order, because you expressed it through dependencies
  - in webpack v2 [tree-shaking] will kick in, which eliminates all unused modules (this is why you should avoid `import *`)
  - you will never get broken links to assets because everything is imported through webpack, which will error out if it cannot find a dependency
  - much nicer authoring experience
  - your code will be ready for the future, because ES6 modules are coming to JavaScript

## What We Did Before

There are a gajillion solutions to this problem, depending on your environment. If you're building a plain static site, you might do something like this:

```html
<!-- index.html -->
<script src="carousel.js"></script>
<script src="home.js"></script>
```

Then concatenate and minify those on build. Or if you're in Rails, you can sort of create a dependency tree:

```js
// application.js
//= require ./home
```

```js
// home.js
//= require ./carousel
carousel.initialize();
```

```js
// carousel.js
```

But both approaches have a downside of globals. It doesn't really matter whether you're using webpack of browserify, as long as you start building a dependency tree.

[Gulp]: http://gulpjs.com/
[Brunch]: http://brunch.io/
[tree-shaking]: http://www.2ality.com/2015/12/webpack-tree-shaking.html

*[SPAs]: Single Page Applications
