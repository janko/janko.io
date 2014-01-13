# A sample Guardfile
# More info at https://github.com/guard/guard#readme

require "coffee_script"

guard "sass",
  input: "_assets/stylesheets",
  output: "assets/stylesheets",
  all_on_start: true,
  style: :compressed,
  load_paths: ["_assets/stylesheets", "_vendor/stylesheets"]

guard "sprockets",
  root_file: "_assets/javascripts/application.js",
  destination: "assets/javascripts",
  asset_paths: ["_assets/javascripts", "_vendor/javascripts"],
  minify: true do

  watch %r{^_assets/javascripts/.+\.js(\.coffee)?$}

end

guard "jekyll-plus",
  extensions: ["scss", "js", "coffee", "erb"],
  serve: true do

  watch /.*/
  ignore /^_site/

end
