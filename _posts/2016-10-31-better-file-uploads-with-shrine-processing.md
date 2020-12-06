---
title: "Better File Uploads with Shrine: Processing"
tags: ruby file attachment upload shrine library gem
excerpt: "This is the 4th part of a series of blog posts about Shrine. In this
  part I talk about doing file processing with Shrine, both on upload and
  on-the-fly."
updated: 15.9.2019.
---

Whenever we accept file uploads, we usually want to apply some processing
to the files before storing them to permanent storage. We might want to

* generate image thumbnails
* optimize images
* transcode videos
* extract video screenshots
* ...

One approach is to process files on-the-fly, which is suitable for fast
processing such as image resizing. However, longer running processing it's
generally better perform eagerly in a background job.

Each approach is suitable for certain requirements, and Shrine is the only
file attachment library that supports both strategies. In this article we'll
talk about the latter – eager processing.

## Image processing

Paperclip, CarrierWave, Dragonfly and Refile all ship with high-level helpers
for image processing via ImageMagick. However, the concept of file processing
isn't actually specific to the context of accepting file uploads, it is a
generic thing. So wouldn't it be nice that, instead of each file attachment
library reimplementing file processing over and over again, we just had a
generic library which we could use with *any* file attachment library?

This is exactly what I did when I created Shrine. I extracted image processing
logic from [Refile::MiniMagick], and released a generic [ImageProcessing]
library. It provides processing helper methods for [ImageMagick]
(using [MiniMagick]) *and* [libvips] \(using [ruby-vips]). Once [ImageFlow]
gets released, I will add support for it as well.

```rb
require "image_processing/mini_magick"

# convert source.jpg -auto-orient -resize 600x600> -sharpen 0x1 output.jpg
thumbnail = ImageProcessing::MiniMagick
  .source(image)
  .convert("jpeg")
  .resize_to_limit!(600, 600)

thumbnail #=> #<Tempfile>
```

## Eager processing

Generating and saving a set of processed files is provided by the
**[derivatives]** Shrine plugin. We use it by defining a processor that returns
processed files, and then trigger the creation at the desired time:

```rb
Shrine.plugin :derivatives
```
```rb
class ImageUploader < Shrine
  Attacher.derivatives do |original|
    magick = ImageProcessing::MiniMagick.source(original)

    {
      small:  magick.resize_to_limit!(300, 300),
      medium: magick.resize_to_limit!(500, 500),
      large:  magick.resize_to_limit!(800, 800),
    }
  end
end
```
```rb
class PhotosController < ApplicationController
  def create
    photo = Photo.new(photo_params)

    if photo.valid?
      photo.image_derivatives! # calls the processor
      photo.save
      # ...
    else
      # ...
    end
  end
end
```

In contrast to CarrierWave's implicit class-level DSL or Paperclip's hash-based
declaration, with Shrine file processing is performed explicitly on the
instance level, using plain Ruby. This gives you full control, allowing things
like extracting processing into a service object and testing it in isolation,
better optimizations, and ability to use any file processing tool you need.

Also, unlike CarrierWave and Paperclip, Shrine actually stores data about
processed files into the database:

```rb
photo.image_data #=> 
# {
#   "id": "fed517.jpg",
#   "storage": "store",
#   "metadata": { ... },
#   "derivatives": {
#      "small": { "id": "586ef3.jpg", "storage": "store", "metadata": { ... } },
#      "medium": { "id": "0461d3.jpg", "storage": "store", "metadata": { ... } },
#      "large": { "id": "4f180c.jpg", "storage": "store", "metadata": { ... } },
#   }
# }

photo.image_derivatives #=>
# {
#   small: #<Shrine::UploadedFile id="586ef3.jpg" storage=:store ...>,
#   medium: #<Shrine::UploadedFile id="0461d3.jpg" storage=:store ...>,
#   large: #<Shrine::UploadedFile id="4f180c.jpg" storage=:store ...>,
# }
```

You can also trigger processing in a [background job][backgrounding]:

```rb
Shrine.plugin :backgrounding
Shrine::Attacher.promote_block { PromoteJob.perform_later(record, name, file_data) }
```
```rb
class PhotosController < ApplicationController
  def create
    photo = Photo.create(photo_params) # kicks off a background job
    # ...
  end
end
```
```rb
class PromoteJob < ActiveJob::Base
  def perform(record, name, file_data)
    attacher = Shrine::Attacher.retrieve(model: record, name: name, file: file_data)
    attacher.create_derivatives # call the processor and upload results
    attacher.atomic_promote
  end
end
```

Just to show that processing in Shrine isn't in any way tied to images or the
ImageProcessing gem, here is an example of processing videos using
[streamio-ffmpeg]:

```rb
# Gemfile
gem "streamio-ffmpeg"
```
```rb
require "streamio-ffmpeg"

class VideoUploader < Shrine
  Attacher.derivatives do |original|
    transcoded = Tempfile.new ["transcoded", ".mp4"]
    screenshot = Tempfile.new ["screenshot", ".jpg"]

    movie = FFMPEG::Movie.new(original.path)
    movie.transcode(transcoded.path)
    movie.screenshot(screenshot.path)

    { transcoded: transcoded, screenshot: screenshot }
  end
end
```

## External processing

Shrine's flexibility allows you to easily delegate processing to other 3rd
party services. As an example, we'll show transcoding videos with [Transloadit]
using the [shrine-transloadit] gem.

```rb
# Gemfile
gem "shrine-transloadit"
```
```rb
Shrine.storages = {
  cache: Shrine::Storage::S3.new(prefix: "cache", **s3_options),
  store: Shrine::Storage::S3.new(**s3_options),
}

Shrine.plugin :transloadit,
  auth: { key: "<TRANSLOADIT_KEY>", secret: "<TRANSLOADIT_SECRET>" },
  credentials: { cache: :s3_store, store: :s3_store }
```
```rb
class VideoUploader < TransloaditUploader
  Attacher.transloadit_processor do
    import = file.transloadit_import_step
    mp4    = transloadit_step "mp4",  "/video/encode", preset: "mp4",  use: import
    webm   = transloadit_step "webm", "/video/encode", preset: "webm", use: import
    ogv    = transloadit_step "ogv",  "/video/encode", preset: "ogv",  use: import
    export = store.transloadit_export_step use: [mp4, webm, ogv]

    assembly = transloadit.assembly(steps: [import, mp4, webm, ogv, export])
    assembly.create!
  end

  Attacher.transloadit_saver do |results|
    mp4  = store.transloadit_file(results["mp4"])
    webm = store.transloadit_file(results["webm"])
    ogv  = store.transloadit_file(results["ogv"])

    merge_derivatives(mp4: mp4, webm: webm, ogv: ogv) # save processed results
  end
end
```
```rb
class VideoController < ApplicationController
  def create
    video = Video.create(video_params)

    TranscodeJob.perform_later(video, :file, video.file_data)

    # ...
  end
end
```
```rb
class TranscodeJob < ActiveJob::Base
  def perform(video, name, file_data)
    attacher = Shrine::Attacher.retrieve(model: video, name: name, file: file_data)

    response = attacher.transloadit_process # calls processor
    response.reload_until_finished!

    attacher.transloadit_save(response["results"]) # calls saver
    attacher.atomic_persist
  rescue Shrine::AttachmentChanged, ActiveRecord::RecordNotFound
    attacher.destroy # destroy orphaned files
  end
end
```

The above will spawn a `TranscodeJob` when a video is attached, then in the
background job it will call Transloadit, wait for processing to finish, then
save the results. If in the meantime the attachment has changed or the record
was deleted, we make sure to delete the processed files to not leave any orphan
files in our storage.

Notice how the `derivatives` plugin allowed us to easily save files uploaded by
Transloadit with `Attacher#merge_derivatives`. This way processed files are
retrieved the same as if we did the processing ourselves, which enables our
application to remain agnostic as to how the files were processed.

```rb
video.file_derivatives #=> 
# {
#   mp4:  #<Shrine::UploadedFile id="c8ed02.mp4" storage=:store ...>,
#   webm: #<Shrine::UploadedFile id="f426d8.webm" storage=:store ...>,
#   ogv:  #<Shrine::UploadedFile id="7a79d6.ogv" storage=:store ...>,
# }
```

## Conclusion

Since my goal with Shrine was to create a file attachment library that works
for everyone, I wanted to make sure that there aren't any limits in ways that
you can do file processing. We've seen how we can do processing ourselves, or
easily delegate it to a 3rd party service. This makes Shrine a versatile tool
for handling any type of file uploads.

[Shrine]: https://github.com/shrinerb/shrine
[Refile::MiniMagick]: https://github.com/refile/refile-mini_magick
[ImageProcessing]: https://github.com/janko/image_processing
[ImageMagick]: https://www.imagemagick.org
[libvips]: http://libvips.github.io/libvips/
[ruby-vips]: https://github.com/libvips/ruby-vips
[ImageFlow]: https://www.imageflow.io/
[MiniMagick]: https://github.com/minimagick/minimagick
[Transloadit]: https://transloadit.com/
[shrine-transloadit]: https://github.com/shrinerb/shrine-transloadit
[derivatives]: https://shrinerb.com/docs/plugins/derivatives
[backgrounding]: https://shrinerb.com/docs/plugins/backgrounding
[streamio-ffmpeg]: https://github.com/streamio/streamio-ffmpeg
