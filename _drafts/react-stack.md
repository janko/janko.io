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

```
npm install --save-dev babel-core babel-preset-es2015 babel-preset-stage-2 babel-preset-react
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

## Refactoring

If you're going to be maintaining a React app, you'll often refactor your app to implement new libraries and best practices that you learned about. Refactoring by hand is boring and error-prone, and simple search & replace only gets you so far. [JSCodeShift] is a tool you should learn how to use, it will save you time and bring you happiness. You shouldn't have to deal with crappy code just because you don't have time to refactor it.

[JSCodeShift]: https://github.com/facebook/jscodeshift

## Data Flow

### Side-Effects

It's really important to have a good, testable system for adding side-effects to Redux actions. A side-effect can be anything, an API call, a redirect, or even dispatching another action.

## Testing

To me testing React code is pretty interesting. You can cover a lot with just Node unit testing, which is really fast.

## Optimizing

You think you're going to get away with your 2M `bundle.js`?

## Deploying

If you're building a SPA and using HTML5 History, you should set up your server to map (not redirect) all routes to `index.html`. Otherwise once you go to `/users` and refresh your browser, your server would look for `/users/index.html`, which does not exist. With mapping, any route will serve `index.html`, which can then check your URL and display the correct route.
