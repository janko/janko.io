---
title: "Better File Uploads with Shrine: Processing"
tags: ruby file attachment upload shrine library gem
excerpt: "This is the 4th part of a series of blog posts about Shrine. In this
  part I talk about doing file processing with Shrine, both on upload and
  on-the-fly."
---

*This is 4th part of a series of blog posts about [Shrine]. The aim of this
series is to show the advantages of using Shrine over other file attachment
libraries.*

----

Whenever we accept file uploads, we usually want to apply some processing
to the files before storing them to permanent storage. Some examples include:

* generating image thumbnails
* optimizing images
* transcoding videos
* extracting video screenshots

We can perform processing in various ways, depending on our application, and
also the type of files we're uploading. For example, while on-the-fly
processing can be very suitable for images, it might not be the best fit for
large files like videos. So a file attachment library should ideally allow you
to process files in whichever way is suitable for your requirements.

In this post I want to show all the options that [Shrine] gives you for file
processing, separated into three sections:

1. **manual processing**
2. **external processing**
3. **on-the-fly processing**

## Manual processing

Unlike CarrierWave's implicit class-level DSL or Paperclip's hash-based
declaration, with Shrine you perform file processing explicitly on the instance
level, using plain Ruby. Having this level of control gives you more
possibilities to better optimize processing.

### Tools

Paperclip, CarrierWave, Dragonfly and Refile all ship with high-level helpers
for image processing via ImageMagick. However, the concept of file processing
isn't actually specific to the context of accepting file uploads, it is a
generic thing. So wouldn't it be nice that, instead of each file attachment
library reimplementing file processing over and over again, we just had a
generic library which we could use with *any* file attachment library?

This is exactly what I did when I created Shrine. I extracted image processing
logic from [Refile::MiniMagick], and released a generic [ImageProcessing]
library. It provides processing helper methods for [ImageMagick]
(using [MiniMagick]) *and* [libvips] \(using [ruby-vips]). And once [ImageFlow]
gets released, it will definitely get into ImageProcessing as well.

Other types of files (video, audio, document etc) can also be processed using
generic tools and hooked up to Shrine, we will show an example later in the
post.

### Basics

In the context of attaching uploaded files to database records, the most
optimal place to perform processing is **after the record has been saved**. At
that point the file has already been successfully [validated][validation], and
this part can also be put into a [background job][backgrounding].

We can hook up to this phase with the `processing` Shrine plugin:

```rb
class ImageUploader < Shrine
  plugin :processing

  process(:store) do |io|
    # processing goes here
  end
end
```

Shrine treats processing as a functional transformation: you are given the
original file (`io`), and are expected to return the processed files. How you are
going to perform processing is entirely up to you, the result just needs to
be an IO object, which Shrine will then continue uploading instead of the
original file.

Let's assume that we're accepting image uploads. Since users will likely upload
images in various sizes, we want to make sure that images are resized to some
normal dimensions before they're stored to permanent storage. Let's use the
ImageProcessing library to limit maximum dimensions to `800x800`:

```rb
# Gemfile
gem "image_processing", "~> 1.0"
gem "mini_magick", "~> 4.0"
```
```rb
require "image_processing/mini_magick"

class ImageUploader < Shrine
  plugin :processing

  process(:store) do |io|
    original = io.download

    resized = ImageProcessing::MiniMagick
      .source(original)
      .resize_to_limit!(800, 800)

    original.close!

    resized
  end
end
```

Because processing itself isn't in any way tied to Shrine, we can also extract
it into a service class and test it in isolation.

```rb
class ImageUploader < Shrine
  plugin :processing
  process(:store) { |io| Processors::ImageNormalizer.call(io) }
end
```
```rb
class Processors::ImageNormalizer # plain class
  def call(io)
    # ...
  end
end
```

### Versions

Sometimes we want to generate multiple files as the result of processing. If
we're handling images, we might want to store various thumbnails alongside the
original image. If we're handling videos, we might want to save screenshots
or transcode the video into different formats.

To be able save multiple files, we just need to load the `versions` plugin, and
then in processing block we can return a Hash of files.

```rb
require "image_processing/mini_magick"

class ImageUploader < Shrine
  plugin :processing
  plugin :versions # enable Shrine to handle a hash of files

  process(:store) do |io|
    original = io.download
    processor = ImageProcessing::MiniMagick

    size_800 = processor.source(original).resize_to_limit!(800, 800)
    size_500 = processor.source(size_800).resize_to_limit!(500, 500)
    size_300 = processor.source(size_500).resize_to_limit!(300, 300)

    original.close!

    { original: io, large: size_800, medium: size_500, small: size_300 }
  end
end
```

Notice how we deliberately generate the next thumbnail from the previous, which
makes the overall processing faster. When possible, you can even parallelize
processing for better performance. This is the kind of control I'm talking
about, which allows you to fully optimize your processing.

After the processed files have been uploaded, unlike all other file attachment
libraries (with the exception of [Paperdragon]), Shrine actually saves the data
about each uploaded file to the database column. The attachment getter method
then reads this data, returns it as a hash of `Shrine::UploadedFile` objects.

```rb
class Photo < Sequel::Model
  include ImageUploader::Attachment.new(:image) # uses `image_data` column
end
```
```rb
photo = Photo.create(image: file)
photo.image_data #=>
# '{
#   "large": {"id":"lg043.jpg", "storage":"store", "metadata":{...}},
#   "medium": {"id":"kd9fk.jpg", "storage":"store", "metadata":{...}},
#   "small": {"id":"932fl.jpg", "storage":"store", "metadata":{...}}
# }'

photo.image #=>
# {
#   :large =>  #<Shrine::UploadedFile @data={"id"=>"lg043.jpg", ...}>,
#   :medium => #<Shrine::UploadedFile @data={"id"=>"kd9fk.jpg", ...}>,
#   :small =>  #<Shrine::UploadedFile @data={"id"=>"932fl.jpg", ...}>,
# }

photo.image[:medium]     #=> #<Shrine::UploadedFile>
photo.image[:medium].url #=> "/uploads/store/lg043.jpg"
```

See also an [example of video transcoding and extracting screenshots][video
processing], which demonstrates how you can hook up a command-line processing
tool.

## External processing

While doing file processing yourself definitely has advantages, there are many
reasons why you might want to offload it to a 3rd party service:

* one less thing that you need to scale
* processing will likely be faster
* lower security risk

One superb web service for processing on upload is [Transloadit], and there is a
[shrine-transloadit] plugin which makes integrating with Transloadit a breeze.
Let's assume that we have [direct uploads to Amazon S3][direct S3] set up, and
we want to handle video uploads. This is how we can add asynchronous video
transcoding using shrine-transloadit:

```rb
gem "shrine-transloadit"
```
```rb
class TransloaditUploader < Shrine
  plugin :transloadit,
    auth_key: "<TRANSLOADIT_KEY>",
    auth_secret: "<TRANSLOADIT_SECRET>"
end
```
```rb
class VideoUploader < TransloaditUploader
  plugin :versions

  def transloadit_process(io, context)
    original = transloadit_file(io)

    files = {
      mp4:  original.add_step("mp4",  "/video/encode", preset: "mp4"),
      webm: original.add_step("webm", "/video/encode", preset: "webm"),
      ogv:  original.add_step("ogv",  "/video/encode", preset: "ogv"),
    }

    transloadit_assembly(files, notify_url: "http://myapp.com/webhooks/transloadit", context: context)
  end
end
```

```rb
post "/webhooks/transloadit" do
  TransloaditUploader::Attacher.transloadit_save(params)
  # return 200 status
end
```

There is so much that shrine-transloadit does for you here, I'll explain:

After the video has been uploaded directly to S3 and submitted to your
application, its information is contained in the `io` variable. The
`transloadit_file(io)` call then generates an "import" step with all
information Transloadit needs to fetch this file from S3. Afterwards steps for
transcoding the video are defined, and formed into a single "assembly", so that
all three formats are processed in parallel. Finally, the export steps for
storing processed files are generated automatically using your S3 storage
credentials, and all this is submitted to Transloadit.

Once Transloadit finishes with processing, it POSTs the results to your app.
The `transloadit_save(params)` call first checks the received signature, to
verify that the request indeed came from Transloadit. Afterwards it transforms
the Transloadit results into Shrine JSON representation, retrieves the database
record (using class/id that were automatically sent in the initial request
which Transloadit then echoed back), and saves information about the processed
files to the Shrine attachment column.

As you can see, even though there can be a lot of complexity in delegating
processing to a 3rd party service, Shrine can make it very easy for you.
For comparison, see how much code it takes to set up [CarrierWave & Zencoder].

## On-the-fly processing

If you're handling image uploads, generating all possible thumbnails on upload
might not be the best option. The complexity of responsive design has increased
over time, making it difficult to predict all of the thumbnail sizes the client
might need.

Because of that it's often much simpler to generate thumbnails on-the-fly, only
when the image URL is requested. This means that if you need to change how a
thumbnail is generated, you don't need to iterate through all database records
and regenerate the thumbnail for each image, you just need to change the URL.

```
http://res.cloudinary.com/myapp/image/upload/w_150,h_150,c_fill/nature.jpg
```

Unlike Dragonfly and Refile, Shrine doesn't ship with on-the-fly processing
functionality. That might sound like a dealbreaker, but think about it: why
should Shrine have its own implementation? Image server functionality isn't
related to file attachments, it's only about how you serve the uploaded files
once they have been attached.

There are many solutions for on-the-fly processing, both open source and paid,
that can be used with Shrine.

### Open source

[Attache] is an open-source image server, which can accept uploads and serve
the uploaded files. It is meant to be run as a standalone app, preferrably
hosted on a different server than your main app, so that it can be scaled
independently. There isn't an Shrine integration for it yet, but it shouldn't
be difficult to write one.

[Dragonfly] is a file attachment library which provides functionality for
on-the-fly processing. At first glance it might appear that Dragonfly can only
be an alternative to Shrine, but Dragonfly's app can actually be used
standalone. We just need to configure the Dragonfly app and add its middleware,
then we can generate Dragonfly URLs to files uploaded by Shrine (let's assume
we're storing files on S3, in which case we need the S3 objects to have
`public-read` permissions and use public URLs).

```rb
Dragonfly.app.configure do
  url_format "/attachments/:job"
  secret "my secure secret" # used to generate the protective SHA
end

use Dragonfly::Middleware
```
```rb
Shrine::Storage::S3.new(upload_options: { acl: "public-read" }, **other_options)
```
```rb
def thumbnail_url(uploaded_file, dimensions)
  Dragonfly.app
    .fetch(uploaded_file.url(public: true))
    .thumb(dimensions)
    .url
end
```
```rb
thumbnail_url(photo.image, "500x400") #=> "/attachments/W1siZnUiLCJodHRwOi8vd3d3LnB1YmxpY2RvbWFpbn..."
```

### Paid

At the moment of this writing, there are Shrine integrations for [Cloudinary],
[Imgix] and [Uploadcare], which are all on-the-fly processing services. For
illustration, let's see how we would set up Cloudinary with Shrine.

Since Cloudinary supports [direct uploads][direct Cloudinary], we'll likely
want to set Cloudinary both as temporary and permanent storage.

```rb
gem "shrine-cloudinary"
```
```rb
require "cloudinary"
require "shrine/storage/cloudinary"

Cloudinary.config(
  cloud_name: "...",
  api_key:    "...",
  api_secret: "...",
)

Shrine.storages = {
  cache: Shrine::Storage::Cloudinary.new(prefix: "cache"),
  store: Shrine::Storage::Cloudinary.new(prefix: "store"),
}
```

Now when your images are uploaded to Cloudinary, you can generate URLs to them
with the parameters for how you want them processed:

```rb
photo.image.url(width: 100, height: 100, crop: :fit)
#=> "http://res.cloudinary.com/myapp/image/upload/w_100,h_100,c_fit/nature.jpg"
```

Cloudinary also has one very advanced feature called "[responsive
breakpoints]", which enables you to automatically generate thumbnails in a way
that will achieve the perfect balance between bandwidth and filesize. We can
utilize that with shrine-cloudinary, by having the thumbnails saved in the
metadata hash.

```rb
Shrine::Storage::Cloudinary.new(
  upload_options: {responsive_breakpoints: {...}},
  store_data: true # store Cloudinary response to metadata
)
```
```rb
photo.image.metadata["cloudinary"]["responsive_breakpoints"] #=>
# [{
#   "breakpoints": {
#     {
#       "width": 1000,
#       "height": 667,
#       "bytes": 79821,
#       "url": "http://res.cloudinary.com/demo/image/upload/c_scale,w_1000/v1453637947/dog.jpg",
#       "secure_url": "https://res.cloudinary.com/demo/image/upload/c_scale,w_1000/v1453637947/dog.jpg"
#     },
#     ...
#   }
# }]
```

## Conclusion

Since my goal with Shrine was to create a file attachment library that works
for everyone, I wanted to make sure that there aren't any limits in ways that
you can do file processing. We've seen how you can do processing manually,
delegate it to an external service, or even have processing done on-the-fly.
This makes Shrine a versatile tool for handling any type of file uploads.

In the next post I will talk about how Shrine handles file metadata, so stay
tuned!

[Shrine]: https://github.com/shrinerb/shrine
[Refile::MiniMagick]: https://github.com/refile/refile-mini_magick
[ImageProcessing]: https://github.com/janko-m/image_processing
[libvips]: http://jcupitt.github.io/libvips/
[ruby-vips]: https://github.com/jcupitt/ruby-vips
[carrierwave-vips]: https://github.com/eltiare/carrierwave-vips
[ImageFlow]: https://www.imageflow.io/
[backgrounding]: http://shrinerb.com/rdoc/classes/Shrine/Plugins/Backgrounding.html
[ImageOptim]: https://github.com/toy/image_optim
[validation]: https://github.com/shrinerb/shrine#validation
[ImageMagick]: https://www.imagemagick.org
[MiniMagick]: https://github.com/minimagick/minimagick
[Paperdragon]: https://github.com/apotonick/paperdragon
[video processing]: https://github.com/shrinerb/shrine#custom-processing
[Transloadit]: https://transloadit.com/
[shrine-transloadit]: https://github.com/shrinerb/shrine-transloadit
[direct S3]: http://shrinerb.com/rdoc/files/doc/direct_s3_md.html
[Attache]: https://github.com/choonkeat/attache
[Dragonfly]: http://markevans.github.io/dragonfly/
[Cloudinary]: https://github.com/shrinerb/shrine-cloudinary
[Imgix]: https://github.com/shrinerb/shrine-imgix
[Uploadcare]: https://github.com/shrinerb/shrine-uploadcare
[CarrierWave & Zencoder]: https://gist.github.com/shamil614/4002368
[direct Cloudinary]: https://github.com/shrinerb/shrine-cloudinary#direct-uploads
[responsive breakpoints]: http://cloudinary.com/blog/introducing_intelligent_responsive_image_breakpoints_solutions
