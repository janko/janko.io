---
layout: post
title: Testing React with Mocha
author: matija
tags: react test mocha jsdom
---

React is very easy and fast to test. The Facebook team recommends [Jest], but I find [Mocha] much more comfortable and easier to configure. To test React code, we need some kind of a DOM, [jsdom] seems like a good fit.

## Why Not Jest?

![I DON'T GET IT, Y U NO USE JEST](/images/yunousejest.png)

[jest]: http://facebook.github.io/jest/
[mocha]: http://mochajs.org/
[jsdom]: https://github.com/tmpvar/jsdom
