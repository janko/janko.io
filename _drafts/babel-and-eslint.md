---
title: Setting Up Babel & ESLint
author: matija
tags: react babel eslint ast
---

[Babel] and [ESLint] go hand-in-hand in frontend development today, so I decided to talk about both of them in this post. You'll learn why they are important and how to set them up.

[Babel]: https://babeljs.io/
[ESLint]: http://eslint.org/

## Babel

It's the transpiler from the future.

### Future Syntax

We can use future syntax now until browser vendors catch up with the implementation. This way you can get comfortable with the syntax sooner and make your code cleaner with fancy new features. Later just remove those Babel transformations and your code becomes:

  - *lighter* --- transpilation always results in more code
  - *faster* ---native implementation is always faster than the polyfill

### React

React recommends using [JSX], an extension to JavaScript. It has to be compiled so the React team built a tool for that, but they later deprecated it in favor of Babel.

[JSX]: https://facebook.github.io/jsx/

### Experimental Features

We can try experimental features, and therefore contribute in discussions about standardization. But don't get ideas and start using those in production, they might not survive the journey to standardization.

### Presets

[Since v6][0], Babel does nothing tangible out of the box. All of the transforms have been split into [lots of plugins][1], and manually choosing them would be unnecessarily tedious. That's why there are [presets]---collections of plugins.

[0]: http://babeljs.io/blog/2015/10/31/setting-up-babel-6
[1]: http://babeljs.io/docs/plugins/
[presets]: https://babeljs.io/docs/plugins/#presets

### Installing

If you've done any serious frontending, you learned how to create a build stack (minifying, preprocessing etc.), so Babel is just one more thing to plug in.

I recommend installing these presets:

  - [preset-es2015]
  - [preset-stage-2]
  - [preset-react] (if you're developing a React app)

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

[preset-es2015]: http://babeljs.io/docs/plugins/preset-es2015/
[preset-stage-2]: http://babeljs.io/docs/plugins/preset-stage-2/
[preset-react]: http://babeljs.io/docs/plugins/preset-react/
[babel-loader]: https://github.com/babel/babel-loader

### Why Stage 2?

[Many people][0] in the React community use [Stage 0] features, which is why I initially used them as well. Until I learned what those stages [actually were][1]. I didn't feel comfortable using features which could disappear, so I switched to using [Stage 2] because it's stable enough and it includes a very useful feature: [object rest/spread].

[0]: https://github.com/search?q=babel-preset-stage-0&ref=opensearch&type=Code
[1]: http://www.2ality.com/2015/11/tc39-process.html#solution-the-tc39-process
[Stage 0]: http://babeljs.io/docs/plugins/preset-stage-0/
[Stage 2]: http://babeljs.io/docs/plugins/preset-stage-2/
[object rest/spread]: http://babeljs.io/docs/plugins/transform-object-rest-spread/

#### But... But... Static Properties, Decorators...

Consider this React example. This is how we would write a component using experimental features:

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

Now, this is how you would write a React component with Stage 2 features:

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

I don't consider this format a trade-off because it's very easy to convert this component into a stateless functional component if needed.

## ESLint

Maintaining a consistent code style is not just an agreement whether to write semicolons or not, setting up a linter like [ESLint] will make you:

  - *faster* --- the linter will warn you that you made a mistake before you run the program and it fails with an error you might not immediately understand
  - *better* --- you'll learn **why** some rules are enforced

Requirement to write your code without semicolons is not annoying by itself, it's usually the fact that you keep forgetting to do that because nothing is forcing you. Linters are here to help, where it's not important if a rule is crazy,  it's important that everyone sticks to it. Instead of making your contributors read a style guide, make linting a part of testing so contributors won't be able to skip it.

### Shareable Configs

There are [tons of rules][0] to choose from and manually configuring them can initially take a lot of time and energy. I suggest simply extending [Airbnb's wonderful config][1], which includes React rules, import checks etc., and adjust rules to your liking. If you feel like it, you can even read [Airbnb's JavaScript Style Guide][2]. I don't usually read, but I found it so interesting that I read the whole thing.

[0]: http://eslint.org/docs/rules/
[1]: https://www.npmjs.com/package/eslint-config-airbnb
[2]: https://github.com/airbnb/javascript

### Integrations

I strongly recommend installing an ESLint [plugin][0] in your editor, it will improve the speed of catching errors because you would be catching errors as you type, instead of being welcomed by 50 errors when you run the lint command.

[0]: http://eslint.org/docs/user-guide/integrations#editors

### Experimental Features

ESLint doesn't support experimental features out of the box, except the highly requested object rest/spread feature. You could plug in [babel-eslint], but you probably don't need it, as the beginning of the readme suggests.

[babel-eslint]: https://github.com/babel/babel-eslint

### Custom Rules

Maybe you're in a large team and ESLint and its plugins simply don't have a rule you'd like to enforce. You can [write your own][0]! If you've never worked with an [AST][astexplorer] before, it can be quite a learning curve, but this skill will be really come in handy for using some other tools as well, like [JSCodeShift].

[0]: http://eslint.org/docs/developer-guide/working-with-rules
[astexplorer]: http://astexplorer.net
[JSCodeShift]: https://github.com/facebook/jscodeshift
