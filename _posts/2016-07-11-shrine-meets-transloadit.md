---
title: Shrine meets Transloadit
tags: shrine
comments: disqus
---

When I'm building web applications, a requirement that almost always comes up
is that the app needs to accept file uploads. It can be an app with users that
have profile images, posts that have cover photos and some additional documents
attached, or whole galleries where people can upload many photos or videos.

Because I wasn't satisfied with current Ruby libraries for handling file
attachments, I created [Shrine]. Its goal was to give you complete control
over the whole attachment process, while still keeping convenience. It comes
with many advanced features out-of-the-box, most notable being the ability to
build a [fully asynchronous user experience] using direct uploads and
background jobs.

In order to best display uploaded files to the users, we usually want to apply
some kind of processing beforehand. We might want to generate multiple sizes of
an uploaded image, split PDF pages into individual images, or encode videos and
extract thumbnails from them. Like other file upload libraries, Shrine allows
us to perform our own processing.

However, doing your own processing comes at a cost of having to scale it, so it
often makes sense to delegate processing to a dedicate service, which gives you
more time to focus on the business logic of your application. One service for
file processing that really impressed me is **Transloadit**.

## Transloadit

[Transloadit] is a service for uploading and processing any kind of media,
including images, videos, audio, and documents, along with importing from and
exporting to various storage services. It is extremely versatile, and by doing
processing asynchronously it's suitable for both quick processing and long
running jobs. Transloadit is also the company behind [tus], an open protocol
for resumable file uploads.

Unlike most other file processing services, Transloadit is only in charge of
processing, and allows you to export the processed files to dedicated storage
services like Amazon S3. This means that Transloadit will work as an *addition*
to your primary storage, not a replacement. It also means that our file
attachments library needs to be flexible enough to support implementing this
kind of flow.

Luckily, Shrine's [plugin system] allows us to easily extend any part of
Shrine, enabling us to add Transloadit-specific methods and intercept default
actions. Using this and Transloadit's [Ruby SDK], I created
**[shrine-transloadit]**.

## Integration

Let's assume that we have an application which already accepts photo uploads to
Amazon S3 using Shrine, and we want to add processing with Transloadit. First,
we need to create our S3 credentails in Transloadit, let's say we named them
`s3_store`.

Now we can configure Shrine and shrine-transloadit with our credentials:

```rb
gem "shrine", "~> 3.0"
gem "aws-sdk-s3", "~> 1.14" # for Amazon S3
gem "shrine-transloadit", "~> 1.0"
```

```rb
require "shrine"
require "shrine/storage/s3"

s3_options = {
  access_key_id:     "<YOUR_ACCESS_KEY_ID>",
  secret_access_key: "<YOUR_SECRET_ACCESS_KEY>",
  region:            "<YOUR_REGION>",
  bucket:            "<YOUR_BUCKET>",
}

Shrine.storages = {
  cache: Shrine::Storage::S3.new(prefix: "cache", **s3_options),
  store: Shrine::Storage::S3.new(**s3_options),
}

Shrine.plugin :transloadit,
  auth: {
    key:    "<YOUR_TRANSLOADIT_KEY>",
    secret: "<YOUR_TRANSLOADIT_SECRET>",
  },
  credentials: {
    cache: :s3_store, # use "s3_store" for :cache storage credentials
    store: :s3_store, # use "s3_store" for :store storage credentials
  }

Shrine.plugin :derivatives # for storing processed results
```

Next, we can define a "processor" that will create a Transloadit assembly, and
a "saver" that will save the processed results:

```rb
class ImageUploader < Shrine
  Attacher.transloadit_processor do
    import   = file.transloadit_import_step
    optimize = transloadit_step "optimize", "/image/optimize", use: import
    resize   = transloadit_step "resize",   "/image/resize",   use: import, width: 300
    export   = store.transloadit_export_step use: [import, optimize, resize]

    assembly = transloadit.assembly(steps: [import, optimize, resize, export])
    assembly.create!
  end

  Attacher.transloadit_processor do |results|
    optimized = store.transloadit_file(results["optimize"])
    thumbnail = store.transloadit_file(results["resize"])

    merge_derivatives(optimized: optimized, thumbnail: thumbnail)
  end
end
```

Now we're ready to perform the processing with Transloadit:

```rb
class PhotosController < ApplicationController
  def create
    photo = Photo.create(photo_params)

    ProcessImageJob.perform_later(photo, :image)

    # ...
  end
end
```
```rb
class ProcessImageJob < ActiveJob::Base
  def perform(record, name)
    attacher = record.send(:"#{name}_attacher")

    response = attacher.transloadit_process # calls processor
    response.reload_until_finished!

    attacher.transloadit_save(response["results"]) # calls saver
    attacher.persist
  end
end
```

And that's it! Now when we upload an image to S3 and save the database record,
a background job will be spawned which will trigger Transloadit processing.
When Transloadit is finished, the processing results will be saved into the
database record.

```rb
photo.image_derivatives #=>
# {
#   optimized: #<Shrine::UploadedFile ...>,
#   thumbnail: #<Shrine::UploadedFile ...>,
# }
```

If you want to see how it all fits together, I created a [demo app] using
shrine-transloadit, which is a good starting point for anyone wanting to add
Transloadit to their Ruby applications. For any additional information head out
to the **[shrine-transloadit]** GitHub respository.

## Conclusion

Thanks to shrine-transloadit, we were able to easily delegate processing to an
external service, and have the processed results saved to the database record.
Transloadit has a rich arsenal of "[robots]", so we still have incredible
flexibility in how we want to do our processing, but without the hassle of
having to scale it.

[Transloadit]: https://transloadit.com/
[Ruby SDK]: https://github.com/transloadit/ruby-sdk
[Shrine]: https://shrinerb.com
[shrine-transloadit]: https://github.com/shrinerb/shrine-transloadit
[tus]: http://tus.io/
[fully asynchronous user experience]: https://twin.github.io/file-uploads-asynchronous-world/
[plugin system]: https://shrinerb.com/docs/creating-storages
[robots]: https://transloadit.com/docs/conversion-robots/
[demo app]: https://github.com/shrinerb/shrine-transloadit/tree/master/demo
