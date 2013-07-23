# A sample Guardfile
# More info at https://github.com/guard/guard#readme

guard "sass", input: "_assets/stylesheets", output: "assets/stylesheets", all_on_start: true

guard "coffeescript", input: "_assets/javascripts", all_on_start: true

guard "sprockets", root_file: "_assets/javascripts/main.js", destination: "assets/javascripts", asset_paths: "_assets/javascripts", minify: true do
  watch(%r{_assets/javascripts/(.+\.js)$})
end

guard "jekyll-plus", extensions: ["scss", "js", "coffee"], serve: true do
  watch /.*/
  ignore /^_site/
end
