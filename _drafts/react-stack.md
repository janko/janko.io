---
title: My React Stack
author: matija
tags: react webpack eslint jscodeshift
---

[Many people complain][0] about how difficult it is to get started with React. I don't think React itself is the issue, it's the tools that it implies, which are completely unrelated to React.

[0]: https://medium.com/@ericclemmons/javascript-fatigue-48d4011b6fc4#.qjevwqtea

## Compiling

React recommends using [JSX], an extension to JavaScript, which has to be compiled. The React team have a tool for that, but they later deprecated it in favor of [Babel].

I'm going to be honest (that's the worst way to start a sentence)---I hate when people include Babel on their complain list, and here's why:

  1. It's such an amazing and important tool, enabling us to use future syntax now and even try out some experimental features.

  2. If you've done any serious frontending, you learned how to create a build stack, so Babel is just one more thing to plug in.

Since v6, Babel doesn't really do anything tangible out of the box. All of the plugins are split into modules, so you need to install the ones you need. There are [tons of them][0] to choose from, but fortunately there are also presets. I recommend installing these:

  - [preset-es2015]
  - [preset-stage-2]
  - [preset-react]

```bash
$ npm install --save-dev babel-core babel-preset-es2015 babel-preset-stage-2 babel-preset-react
```

Then specify those in your `.babelrc`:

```json
{
  "presets": [
    "es2015",
    "stage-2",
    "react"
  ]
}
```

Now you should set up the actual compilation in your build tool.

### Why Stage 2?

Some authority figures in the React community use Stage 0, which is why I was using it as well. But then I learned what those stages [actually are][1]. I don't think it's risky to use features which might not make it to the spec. Stage 2 is safe enough for me and it includes [object rest spread], which really comes in handy in React.

[JSX]: https://facebook.github.io/jsx/
[Babel]: https://babeljs.io/
[0]: https://babeljs.io/docs/plugins/
[preset-es2015]: http://babeljs.io/docs/plugins/preset-es2015/
[preset-stage-2]: http://babeljs.io/docs/plugins/preset-stage-2/
[preset-react]: http://babeljs.io/docs/plugins/preset-react/
[1]: http://www.2ality.com/2015/11/tc39-process.html#solution-the-tc39-process
[object rest spread]: http://babeljs.io/docs/plugins/transform-object-rest-spread/

## Serving And Building

Otherwise you could get away with Grunt/Gulp/Brunch, but in the React stack I believe [webpack] is the only bundler up to the task. I'm not gonna lie, it took me three attempts to finally switch over, but once you figure it out (the awesome and the weird), you start enjoying it. As a beginner you might want to use something like [Unstuck Webpack] to just get it out of the way, but I suggest that you eventually learn it, so you can make alterations when necessary.

[webpack]: http://webpack.github.io
[Unstuck Webpack]: http://www.linuxenko.pro/unstuck-webpack/#/?_k=tsqkfg

## Linting

Maintaining a consistent code style is not just an agreement whether to write semicolons or not, setting up a linter like [ESLint] will make you *faster* and *better* at JavaScript because you'll learn **why** some rules are enforced. There are [tons of rules][0] to choose from and manually configuring them can initially take a lot of time and energy, so I suggest simply extending [Airbnb's wonderful config][1] and override rules to your liking. If you feel like it, you can also read [Airbnb's JavaScript Style Guide][2], I don't usually read, but it was so interesting to me that I read the whole thing.

### Custom Rules

Maybe you're in a large team and ESLint and its plugins simply don't have a rule you'd like to enforce. You can [write your own][3]! If you've never worked with an [AST][astexplorer] before, it can be quite a learning curve, but this skill will be really come in handy for using some other tools as well, like JSCodeShift (explained below).

[ESLint]: http://eslint.org
[0]: http://eslint.org/docs/rules/
[1]: https://www.npmjs.com/package/eslint-config-airbnb
[2]: https://github.com/airbnb/javascript
[3]: http://eslint.org/docs/developer-guide/working-with-rules
[astexplorer]: http://astexplorer.net

## Actually Developing

### Routing

There are currently two good routing libraries, [React Router] and [Cerebral]. I haven't tried the latter, but it's gaining momentum and it's universal, there are bindings for other frameworks as well, like Angular.

[React Router]: https://github.com/reactjs/react-router
[Cerebral]: http://www.cerebraljs.com/install/react

### State

React's state and context can only get you so far. When building anything substantial, you'll get tangled up, so you need some kind of a library. I haven't really tried anything other than [Redux], but since it's so popular (I don't remember when I have seen so many stars on GitHub :star:), it's a good choice.

[Redux]: https://github.com/reactjs/redux

### Side-Effects

You thought Redux will be enough? This is frontend, nothing is enough. Side-effects are reactions to dispatched actions. Common examples are API calls, redirects, or even dispatching another action. I have struggled with this and found a solution which I'm pretty happy with at the moment---[redux-saga]. The learning curve here could be [generators], which take some getting used to, but this is a really smart usage of them. Sagas are nice to manage because they are completely separate from actions and they are easy to test.

[redux-saga]: http://yelouafi.github.io/redux-saga/
[generators]: https://davidwalsh.name/es6-generators

## Refactoring

If you're going to be maintaining a React app, you'll often refactor your app to implement new libraries and best practices that you learned about. Refactoring by hand is boring and error-prone, and simple search & replace only gets you so far. [JSCodeShift] is a tool you should learn how to use, it will save you time and bring you happiness. You shouldn't have to deal with crappy code just because you don't have time to refactor it.

[JSCodeShift]: https://github.com/facebook/jscodeshift

## Testing

To me testing React code is pretty interesting. You can cover a lot with just Node unit testing, which is really fast. I was looking for some libraries, as a testing framework I started with [Mocha] and as an assertion and spying library I used [expect].

This was ok for a while, but then I found [AVA], which just knocked my socks off. The readme was just hypnotizing, I couldn't stop reading. AVA partially replaced what I was using expect for, so I switched to [Sinon] for spies because it worked nicer with AVA.

Now, what about React? There are handy [Test Utilities] for that, but I find them painfully low-level. I strongly recommend using [Enzyme] by Airbnb (as mentioned in Test Utilities documentation), it has a much nicer API and you can get things done much more easily.

Most of the times you should use [shallow rendering], which makes tests faster and more isolated.

[expect]: https://github.com/mjackson/expect
[Mocha]: http://mochajs.org/
[AVA]: https://github.com/avajs/ava
[Sinon]: http://sinonjs.org/
[Test Utilities]: http://facebook.github.io/react/docs/test-utils.html
[Enzyme]: http://airbnb.io/enzyme/
[shallow rendering]: http://facebook.github.io/react/docs/test-utils.html#shallow-rendering

## Optimizing

You think you're going to get away with your 2M `bundle.js`? There are many ways to optimize your code.

### CSS

In development it's completely fine to render CSS via JS, but in production you could extract that CSS into a separate file. If you're using webpack, you could use [extract-text-webpack-plugin], unless you're one of those [CSS in JS] weirdos.

### Images

webpack has a tendency to inline your images if you're not careful. So make sure that you set a limit in your [url-loader]. Also you can losslessly compress them using [image-webpack-loader] (especially if you're using SVG).

### JavaScript

SPAs are JavaScript-heavy and having to download everything at once on page load is an unnecessary performance hit. You could use webpack's [code splitting] in smart places. Maybe there's a simple front-facing version of your app, and when you log in there's much more functionality included. This is a good place to split your code. If you're using React Router, you could study the API and see how you can split your code using [`getComponent` and `getComponents`][0].

[extract-text-webpack-plugin]: https://github.com/webpack/extract-text-webpack-plugin
[CSS in JS]: https://speakerdeck.com/vjeux/react-css-in-js
[url-loader]: https://github.com/webpack/url-loader
[image-webpack-loader]: https://github.com/tcoopman/image-webpack-loader
[code splitting]: http://webpack.github.io/docs/code-splitting.html
[0]: https://github.com/reactjs/react-router/blob/master/docs/API.md#getcomponentnextstate-callback

## Deploying

If you're building a SPA and using HTML5 History, you should set up your server to map (not redirect) all routes to `index.html`. Otherwise once you go to `/users` and refresh your browser, your server would look for `/users/index.html`, which does not exist. With mapping, any route will serve `index.html`, which can then check your URL and display the correct route.
