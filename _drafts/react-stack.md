---
title: Building Your React Stack
author: matija
tags: react webpack eslint jscodeshift
---

[People complain][0] about how difficult it is to get started with React because of all the tools, but many tools are not really tied to React. It's more accurate to say that the React community has popularized them.

What does it take to build a decent maintainable React application? I will share my experience so far.

[0]: https://medium.com/@ericclemmons/javascript-fatigue-48d4011b6fc4#.qjevwqtea

## Compiling

React recommends using [JSX], an extension to JavaScript. It has to be compiled so the React team built a tool for that, but they later deprecated it in favor of [Babel]. When people complain about all the tooling around React, they often include Babel to the list as well. I don't understand this, and here's why:

  1. You should be using it anyway, regardless if you're coding in React or not. It enables you to use future syntax now until browser implementation catches up. This way you can get comfortable with the syntax sooner and make your code cleaner with fancy new features. Later just remove those Babel transformations and your code becomes lighter and faster.

  2. It enables us to try experimental features, and therefore contribute in discussions about standardization.

  3. If you've done any serious frontending, you learned how to create a build stack (minifying, preprocessing etc.), so Babel is just one more thing to plug in.

Since v6, Babel doesn't do anything tangible out of the box. All of its plugins are split into modules, so you need to install the ones you need. There are [tons of them][0] to choose from, but fortunately there are also presets---meaningful collections of plugins. I recommend installing these:

  - [preset-es2015]
  - [preset-stage-2]
  - [preset-react]


```bash
npm install --save-dev babel-core babel-preset-es2015 babel-preset-stage-2 babel-preset-react
```

Then specify them in your `.babelrc`:

```json
{
  "presets": [
    "es2015",
    "stage-2",
    "react"
  ]
}
```

Now you should set up the actual compilation. If you're using webpack, you should use [babel-loader].

[JSX]: https://facebook.github.io/jsx/
[Babel]: https://babeljs.io/
[0]: https://babeljs.io/docs/plugins/
[preset-es2015]: http://babeljs.io/docs/plugins/preset-es2015/
[preset-stage-2]: http://babeljs.io/docs/plugins/preset-stage-2/
[preset-react]: http://babeljs.io/docs/plugins/preset-react/
[babel-loader]: https://github.com/babel/babel-loader

### Why Stage 2?

Some authority figures in the React community use Stage 0, which is why I was using it as well. But then I learned what those stages [actually are][1]. I think it's risky to use features which might not make it to the spec. Also, when using experimental features you also have to use the [babel-eslint] parser.

Stage 2 is safe enough for me and it includes [object rest spread], which really comes in handy in React. Even though it means no decorators or class properties, there is an upside to that. This is how we would write a React component using experimental features:

```jsx
@connect(state => ({ foo: state.foo }))
export default class Comp extends React.Component {
  static propTypes = {
    foo: React.PropTypes.string,
  };

  static defaultProps = {
    foo: 'bar',
  };

  render() {
    return (
      <div>
        {this.props.foo}
      </div>
    );
  }
}
```

Not a very useful component, but you get the point. Now, this is how you would write a React component with Stage 2 features (and above):

```jsx
class Comp extends React.Component {
  render() {
    return (
      <div>
        {this.props.foo}
      </div>
    );
  }
}

Comp.propTypes = {
  foo: React.PropTypes.string,
};

Comp.defaultProps = {
  foo: 'bar',
};

export default connect(
  state => ({ foo: state.foo })
)(Comp);
```

I don't consider this format a trade-off. Notice how easy it would be to convert this component into a stateless functional component if needed.

[1]: http://www.2ality.com/2015/11/tc39-process.html#solution-the-tc39-process
[babel-eslint]: https://github.com/babel/babel-eslint
[object rest spread]: http://babeljs.io/docs/plugins/transform-object-rest-spread/

## Serving And Building

In other situations you could get away with Grunt/Gulp/Brunch/etc., but in the React stack I believe [webpack] is the only bundler up to the task, so I'll assume it in this tutorial.

I'm not gonna lie, it took me three attempts to finally switch over to webpack, but once you figure it out (the awesome and the weird), you start enjoying it. As a beginner you might want to use something like [Unstuck Webpack], just to get configuration out of the way. However, I suggest that you eventually learn how configuration works, so you can make alterations when necessary.

[webpack]: http://webpack.github.io
[Unstuck Webpack]: http://www.linuxenko.pro/unstuck-webpack/#/?_k=tsqkfg

## Linting

Maintaining a consistent code style is not just an agreement whether to write semicolons or not, setting up a linter like [ESLint] will make you *faster* and *better* at JavaScript because you'll learn **why** some rules are enforced. There are [tons of rules][0] to choose from and manually configuring them can initially take a lot of time and energy. I suggest simply extending [Airbnb's wonderful config][1], which includes React rules, import checks etc., and adjust rules to your liking. If you feel like it, you can even read [Airbnb's JavaScript Style Guide][2]. I don't usually read, but I found it so interesting that I read the whole thing.

### Custom Rules

Maybe you're in a large team and ESLint and its plugins simply don't have a rule you'd like to enforce. You can [write your own][3]! If you've never worked with an [AST][astexplorer] before, it can be quite a learning curve, but this skill will be really come in handy for using some other tools as well, like [JSCodeShift] (more about that later).

[ESLint]: http://eslint.org
[0]: http://eslint.org/docs/rules/
[1]: https://www.npmjs.com/package/eslint-config-airbnb
[2]: https://github.com/airbnb/javascript
[3]: http://eslint.org/docs/developer-guide/working-with-rules
[astexplorer]: http://astexplorer.net
[JSCodeShift]: https://github.com/facebook/jscodeshift

## Developing

### Routing

There are currently two leading routing libraries (that I know of), [React Router] and [Cerebral]. I haven't tried the latter, but it's gaining momentum and there are bindings for other frameworks as well.

[React Router]: https://github.com/reactjs/react-router
[Cerebral]: http://www.cerebraljs.com/install/react

### State

React's state and context can only get you so far. When building anything substantial, you'll get tangled up very quickly, so you need some kind of a library. I haven't really tried anything other than [Redux], but since it's so popular (I don't remember when I have seen so many stars on GitHub :star:), it's a good choice.

[Redux]: https://github.com/reactjs/redux

### Side-Effects

You thought Redux will be enough? This is frontend, nothing is enough. Side-effects are reactions to dispatched actions. Common examples are API calls, redirects, or even dispatching another action. I have struggled with this and found a solution which I'm pretty happy with at the moment---[redux-saga]. The learning curve here could be [generators], which take some getting used to, but this is a really smart usage of them. Sagas are nice to manage because they are completely separate from actions and they are easy to test.

[redux-saga]: http://yelouafi.github.io/redux-saga/
[generators]: https://davidwalsh.name/es6-generators

## Refactoring

If you're going to be maintaining a React app, you'll often refactor your app to implement new libraries and best practices that you learned about. Refactoring by hand is boring and error-prone, and simple search & replace only gets you so far. JSCodeShift is a tool you should learn how to use, it will save you time and bring you happiness. You shouldn't have to deal with crappy code just because you don't have time to refactor it.

## Testing

To me testing React code is pretty interesting. You can cover a lot with just Node unit testing, which is really fast.

I started with Jest, because Facebook built it for React. It was too much for me and it felt unnecessary to be locked down to a framework like that. Then I found out you can use [Mocha], as an assertion and spying library I used [expect]. I was more comfortable with it, it had a nicer output and felt less intrusive.

This was ok for a while, but then I found [AVA], which just knocked my socks off. The readme was just hypnotizing, I couldn't stop reading. Because AVA was partially replacing what I was using expect for, I switched to [Sinon] for spies because it worked nicer with AVA.

Now, what about React? There are handy [Test Utilities] for that, but I find them painfully low-level. I recommend using [Enzyme] by Airbnb, which uses Test Utilities under the hood. It has a nicer API and you can get things done much more easily.

### DOM

Most of the times you should use [shallow rendering], which makes tests faster, more isolated, and you don't need a DOM. In case you want to fully render a component along with child components, you could set up a DOM using [jsdom]. Because of a bug in older versions of React, you always needed to set it up, even for shallow rendering, but that has been fixed.

[expect]: https://github.com/mjackson/expect
[Mocha]: http://mochajs.org/
[AVA]: https://github.com/avajs/ava
[Sinon]: http://sinonjs.org/
[Test Utilities]: http://facebook.github.io/react/docs/test-utils.html
[Enzyme]: http://airbnb.io/enzyme/
[shallow rendering]: http://facebook.github.io/react/docs/test-utils.html#shallow-rendering
[jsdom]: https://github.com/tmpvar/jsdom

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

### History

If you're building a SPA and using HTML5 History, you should set up your server to map (not redirect) all routes to `index.html`. Otherwise once you go to `/users` and refresh your browser, your server would look for `/users/index.html`, which does not exist. With mapping, any route will serve `index.html`, which can then check your URL and display the correct route. webpack server does this for you with the [historyApiFallback] option, but you need to set that up explicitly on your server.

If you're hosting on S3, in the "Enable web hosting" section you could set up "Error Document" to also be `index.html`. This will serve `index.html` as 404, but then your app decides whether the URL matches some route or it really is a 404.

[historyApiFallback]: http://webpack.github.io/docs/webpack-dev-server.html#the-historyapifallback-option

## Conclusion

I'm still learning and I always will, this is simply how far I got. It's been a wild ride so far, but I believe React is teaching me to be a better JavaScript developer.
