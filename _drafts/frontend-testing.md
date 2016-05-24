---
title: Testing React with Mocha
author: matija
tags: react test mocha jsdom
---

## It's Hard

I attempted to maintain tests for my apps multiple times, but until now all of them ended up outdated. I just spontaneously stopped testing, maybe I didn't see much benefit, only that it was slowing me down, or maybe I didn't know what to test exactly and how deep to go.

***

React is very easy and fast to test. The Facebook team recommends [Jest], but I find [Mocha] much more comfortable and easier to configure. To test React code, we need some kind of a DOM, [jsdom] seems like a good fit.

## Why Not Jest?

![I DON'T GET IT, Y U NO USE JEST](/images/yunousejest.png)

[jest]: http://facebook.github.io/jest/
[mocha]: http://mochajs.org/
[jsdom]: https://github.com/tmpvar/jsdom
