---
title: Shrine meets Transloadit
tags: ruby shrine file upload processing
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
running jobs. Transloadit is also the company behind [TUS], the first open
protocol for resumable file uploads.

Unlike most other file processing services, Transloadit is only in charge of
processing, and allows you to export the processed files to dedicated storage
services like Amazon S3. This means that Transloadit will work as an *addition*
to your primary storage, not a replacement. It also means that our file
attachments library needs to be flexible enough to support implementing this
kind of flow.

Luckily, Shrine's [plugin system] enables us to easily extend any part of
Shrine, allowing us to add Transloadit-specific methods and intercept default
actions. Using this and Transloadit's [Ruby SDK], I created
**[shrine-transloadit]**.

## Integration

Let's assume that we have an application which already accepts photo uploads to
Amazon S3 using Shrine, and we want to add processing with Transloadit. First
we need to add shrine-transloadit to the Gemfile, and load the plugin with our
Transloadit credentials:

```rb
gem "shrine"
gem "aws-sdk" # for Amazon S3
gem "shrine-transloadit" # <====
```

```rb
require "shrine"
require "shrine/storage/s3"

s3_options = {
  bucket: "my-bucket",
  region: "my-region",
  access_key_id: "abc",
  secret_access_key: "xyz",
}

Shrine.storages = {
  cache: Shrine::Storage::S3.new(prefix: "cache", **s3_options),
  store: Shrine::Storage::S3.new(prefix: "store", **s3_options),
}

Shrine.plugin :transloadit,
  auth_key: "your transloadit key",
  auth_secret: "your transloadit secret"
```

Now we can define our processing steps in `#transloadit_process` inside our
uploader class. Let's create two versions of the original image: one will be
just resized to sufficient dimensions, and another one will be a small
thumbnail.

Transloadit performs processing asynchronously, and we can provide a URL which
we want it to POST the results of processing to once it's finished.

```rb
class MyUploader < Shrine
  plugin :versions

  def transloadit_process(io, context)
    original = transloadit_file(io)
      .add_step("normalize", "/image/resize", width: 800, zoom: false)
      .add_step("optimize", "/image/optimize")

    thumbnail = original
      .add_step("resize_small", "/image/resize", width: 300)

    files = {original: original, thumbnail: thumbnail}

    transloadit_assembly(files, notify_url: "http://my-app/webhooks/transloadit")
  end
end
```

```rb
post "/webhooks/transloadit" do
  Shrine::Attacher.transloadit_save(params)
end
```

And that's it! Now when we upload an image to S3 and save the database record,
Transloadit will take this image and perform processing, and once it's finished
it will save the results back to S3 and trigger the webhook. The webhook will
then take the information about processed files, convert them into Shrine's
attachments and update the corresponding database record.

Normally you would also have to create import/export steps for processed files,
but shrine-transloadit automatically generates them for you based on your
storage configuration. For best user experience you can even put the requests
to Transloadit into a [background job].

If you want to see how it all fits together, I created a [demo app] showcasing
shrine-transloadit, which is a good starting point for anyone wanting to add
Transloadit to their Ruby applications. For any additional information head out
to the **[shrine-transloadit]** GitHub respository.

## Conclusion

Thanks to shrine-transloadit, with just a few lines of code we were able to
delegate processing to an external service, and have our database records
automatically updated with the processed files. Transloadit has a rich arsenal
of processors ("[robots]"), so we still have incredible flexibility in how we
want to do our processing, but without the hassle of having to scale it.

[Transloadit]: https://transloadit.com/
[Ruby SDK]: https://github.com/transloadit/ruby-sdk
[Shrine]: https://github.com/janko-m/shrine
[shrine-transloadit]: https://github.com/janko-m/shrine-transloadit
[TUS]: http://tus.io/
[fully asynchronous user experience]: https://twin.github.io/file-uploads-asynchronous-world/
[plugin system]: http://shrinerb.com/rdoc/files/doc/creating_plugins_md.html
[robots]: https://transloadit.com/docs/conversion-robots/
[demo app]: https://github.com/janko-m/shrine-transloadit/tree/master/demo
[background job]: https://github.com/janko-m/shrine-transloadit#backgrounding
