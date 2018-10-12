---
title: "Better File Uploads with Shrine: Direct Uploads"
tags: ruby file attachment upload shrine library gem
excerpt: "This is the 6th part of a series of blog posts about Shrine. In this
  part we'll show how to do direct uploads to S3 or your app on the client side,
  as well as how to handle large uploads."
---

*This is 6th part of a series of blog posts about [Shrine]. The aim of this
series is to show the advantages of using Shrine over other file attachment
libraries.*

----

So far we were talking about the server side of handling file uploads. However,
there is a lot that we can also do on the client side to improve user
experience and performance.

Let's say we have a `Photo` model with an `#image` attachment attribute handled
by an `ImageUploader`:

```rb
class Photo < Sequel::Model
  include ImageUploader::Attachment.new(:image)
end
```
```rb
class ImageUploader < Shrine
  # ...
end
```

The simplest file upload worfklow is having a vanilla form with a file field
for selecting files, and also a hidden field for retaining uploaded files in
case of validation errors.

```rb
# for retaining selected files across form redisplays
Shrine.plugin :cached_attachment_data
```
```erb
<form action="/photos" method="post" enctype="multipart/form-data">
  <input type="hidden" name="photo[image]" value="<%= photo.cached_image_data %>" class="attachment-field" />
  <input type="file" name="photo[image]" class="attachment-field" />

  <input type="submit" value="Submit" />
</form>
```

This alone provides a basic uploading user experience. There are many obvious
limitations with the static approach:

* When the user submits the form with selected files, there is no indicator
  telling them when the upload will finish.

* When the user is uploading multiple files at once and the request happens to
  get aborted, it's not possible to keep the files that were uploaded so far,
  because all files are sent in a single request. In other words, multiple
  uploads are all-or-nothing.

* Files are validated only after they have been uploaded, which means the user
  needs to wait until the upload finishes before they can know whether their
  file was even valid.

We can improve that by asynchronously starting to upload files on the client
side as soon as they're selected. This also gives users the ability to continue
filling in other fields while files are being uploaded, because the UI isn't
blocked during the upload.

There are many popular JavaScript file upload libraries out there --
[jQuery-File-Upload], [Dropzone.js], [FineUploader] etc. -- but the one you
should use with Shrine is definitely **[Uppy]** :dog:. Uppy is a modular
library that knows how to upload files to a custom endpoint on your app, to
Amazon S3, or even to a [resumable endpoint][tus], providing progress bars,
drag & drop functionality, image previews, file validations etc, all while
making as few assumptions as possible.

```js
var uppy = Uppy.Core({ /* ... */ })
  .use(Uppy.FileInput,   { /* ... */ }) // adds a pretty file field
  .use(Uppy.ProgressBar, { /* ... */ }) // displays a progress bar
  .use(Uppy.Informer,    { /* ... */ }) // displays validation errors

// ...
```

I find using a generic JavaScript library much more future-proof than relying
on homegrown solutions like what [Refile][refile javascript] or
[ActiveStorage][activestorage javascript] offer. That's why Shrine doesn't come
with its own JavaScript; it can be convenient when you want to get up and
running quickly, but it could never match the features and stability of a
library that's maintained by the whole JavaScript community.

## Theory

The idea is to have a generic endpoint which accepts file uploads and saves the
uploads to a temporary storage. The reason for uploading to a separate temporary
storage is security; if we allowed users to upload directly to the primary
storage, they would be able to flood it if they wanted to, as directly uploaded
files don't have to necessarily end up being attached to a record.

```http
POST http://example.com/upload HTTP/1.1

[... file content ...]
```

On the client side we would asynchronously upload selected files to this
endpoint, and then send only the information about the cached files on form
submission. Once validation has passed and the record has been successfully
saved, Shrine would automatically upload the cached file to permanent storage.

In fact, Shrine already handles attachments this way. When a file is attached,
Shrine first uploads it to temporary storage, and then once the record has
been successfully saved the cached file is uploaded to permanent storage.

```rb
photo.image = File.open("...") # files gets uploaded to temporary storage
photo.image # cached file
photo.save
photo.image # stored file
```

With direct uploads the only difference is that files are uploaded to temporary
storage prior to attachment, and then the information about the cached file is
assigned instead of an actual file, in which case Shrine skips the caching step.

```rb
photo.image = '{"id":"...","storage":"cache","metadata":{...}}'
photo.image # cached file that we assigned
photo.save
photo.image # stored file
```

## 1. Simple upload

The simplest way we could enable direct uploads is to create an upload endpoint
in our app. Shrine comes with an [upload_endpoint] plugin which allows you to
create a Rack application that accepts file uploads and forwards them to the
specified storage. The only thing we need to do is mount the app to our
preferred path:

```rb
Shrine.plugin :upload_endpoint
```
```rb
Rails.application.routes.draw do
  mount ImageUploader.upload_endpoint(:cache) => "/images/upload"
end
```

The above gives our application a `POST /images/upload` endpoint which accepts
the `file` multipart parameter and returns uploaded file data:

```http
POST /images/upload HTTP/1.1
Content-Type: multipart/form-data

[... file content ...]
```
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "id": "70be82a657ba9ef892ef5182a1a18bde.jpg",
  "storage": "cache",
  "metadata": {
    "size": 3942146,
    "filename": "nature.jpg",
    "mime_type": "image/jpeg"
  }
}
```

Because Shrine's upload endpoint is a pure Rack application, it can be run
inside any Rack-based Ruby web framework (Sinatra, Roda, Cuba, Hanami, Grape
etc), not just Rails. The `:cache` argument to `Shrine.upload_endpoint`
specifies that incoming files will be uploaded to the configured temporary
storage.

### Client side

On the client side we just need to add the [XHRUpload] Uppy plugin and point
it to this endpoint.

```js
// ... other plugins ...

uppy.use(Uppy.XHRUpload, {
  endpoint: "/images/upload",
  fieldName: "file",
})

uppy.on('upload-success', function (file, data) {
  var uploadedFileData = JSON.stringify(data)

  var hiddenField = document.querySelector('.attachment-field[type=hidden]')
  hiddenField.value = uploadedFileData
})
```

Notice that the response of Shrine's upload endpoint already contains the
uploaded file data in the format that can be assigned, so the only thing left
to do is convert it to JSON and write it to the hidden attachment field to be
submitted as the attachment.

## 2. Amazon S3

Uploading files to our app isn't always the most suitable option. In most cases
we don't want store uploaded files on disk, but rather on a cloud service like
Amazon S3, Google Cloud Storage or Microsoft Azure Storage, especially if our
app is running on Heroku or on multiple servers. In that case, instead of
uploading files to our app and then to the cloud service, it's more performant
to skip the app and upload directly to the cloud.

First we tell Shrine that we'll be using S3 both for temporary and permanent
storage, but specify separate directories:

```rb
# Gemfile
gem "aws-sdk-s3", "~> 1.2"
```
```rb
require "shrine/storage/s3"

Shrine.storages = {
  cache: Shrine::Storage::S3.new(prefix: "cache", **options),
  store: Shrine::Storage::S3.new(**options),
}
```

The client side flow mostly stays the same, except that the browser now needs
to ask the server for the upload URL and request parameters on each upload.
Shrine has the [presign_endpoint] plugin which provides a Rack application that
generates direct upload parameters, which we can mount in our application:

```rb
Shrine.plugin :presign_endpoint, presign_options: {
  filename = request.params["filename"]
  type     = request.params["type"]

  {
    content_disposition:    "inline; filename=\"#{filename}\"", # set download filename
    content_type:           type,                               # set content type (defaults to "application/octet-stream")
    content_length_range:   0..(10*1024*1024),                  # limit upload size to 10 MB
  }
}
```
```rb
Rails.application.routes.draw do
  mount Shrine.presign_endpoint(:cache) => "/presign"
end
```

Our application has now gained the `GET /presign` endpoint which will return
URL and parameters for direct upload:

```http
GET /presign HTTP/1.1
```
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "url": "https://your-bucket.s3.us-east-1.amazonaws.com",
  "fields": {
    "key": "cache/df65ee371b42b87463b1840d69331692.jpg",
    "policy": "eyJleHBpcmF0aW9uIjoiMjFrs0wMS0wM1QxNzo0MjoxNloiLCJjb25kaXRpb25zIjpbeyJidWNrZXQiOiJzaHJpbmUtdGVzdGluZy0yIn0seyJrZXkiOiJjYWNoZS9kZjY1ZWUzNzFiNDJiODc0NjNiMTg0MGQ2OTMzMTY5Mi5qcGcifSx7IngtYW16LWNyZWRlbnRpYWwiOiJBS0lBSU1ESDJIVFNCM1JLQjRXUS8yMDE4MDEwMy9ldS1jZW50cmFsLTEvczMvYXdzNF9yZXF1ZXN0In0seyJ4LWFtei1hbGdvcml0aG0iOiJBV1M0LUhNQUMtU0hBMjU2In0seyJ4LWFtei1kYXRlIjoiMjAxODAxMDNUMTY0MjE2WiJ9XX0=",
    "x-amz-credential": "AKIAI8FLFDSB3RKB4WQ/20180103/eu-central-1/s3/aws4_request",
    "x-amz-algorithm": "AWS4-HMAC-SHA256",
    "x-amz-date": "20180103T164216Z",
    "x-amz-signature": "6003f73624724fd2e116620ddc77f1073b434c677ddf7070a67445016c62a263"
  },
  "headers": {},
  "method": "post"
}
```

### Client side

On the client side we have the [AwsS3] Uppy plugin (instead of XHRUpload). Note
that you'll need to update your S3 bucket's [CORS configuration][aws-s3 cors]
to allow client side uploads.

The AwsS3 plugin requires that we fetch the upload parameters ourselves; we can
use `window.fetch` to make a request to our presign endpoint, which already
happens to return data in the format that Uppy expects:

```js
// ... other plugins ...

uppy.use(Uppy.AwsS3, {
  getUploadParameters: function (file) {
    return fetch('/presign?filename=' + encodeURIComponent(file.name) + '&type=' + file.type, {
      credentials: 'same-origin', // send cookies
    }).then(function (response) { return response.json() })
  }
})

uppy.on('upload-success', function (file, data) {
  var uploadedFileData = JSON.stringify({
    id: file.meta['key'].match(/^cache\/(.+)/)[1], // remove the Shrine storage prefix
    storage: 'cache',
    metadata: {
      size:      file.size,
      filename:  file.name,
      mime_type: file.type,
    }
  })

  // ...
})
```

You'll notice that, unlike our simple upload endpoint which generated the
uploaded file data for us, in the S3 case we need to construct the uploaded
file data ourselves on the client side.

Fetching direct upload parameters dynamically like this is much more flexible
than creating a static S3 upload form on page render, which is the approach
that [CarrierWave][carrierwave direct] and [Paperclip][paperclip direct]
ecosystems seem to prefer. A static S3 form won't work with multiple uploads,
as S3 requires that each file has a new set of upload parameters.

Finally, this approach is not specific to Amazon S3, you can use it with any
service that supports direct uploads, such as [Google Cloud
Storage][shrine-google_cloud_storage], [Cloudinary][shrine-cloudinary],
[Transloadit][shrine-transloadit] and others.

## 3. Resumable upload

For most use cases, direct upload to a custom endpoint or a cloud service
should be everything you need. This is because the majority of applications are
dealing only with images, documents, or other small files. If your application
happens to deal with large files such as videos, things get a bit more
interesting.

If you've ever used a service where you needed to upload 500MB, 1GB or 5GB
files, you know how frustrating when your upload is 80% complete and then it
fails, all because you happened to have lost internet connection for a brief
moment, or you had to change locations, or your browser/OS crashed. With slow
and/or flaky internet connections it might not even be possible to upload
larger files, because every time the upload fails it would have to be retried
from the beginning.

**[Tus.io][tus]** is the open protocol for resumable file uploads built on
HTTP. It specifies the [behaviour and communication][tus protocol] required
between client and the server during file upload so that the upload is
resumable in case the request failed. Try their [demo][tus demo] to see this in
action.

There are many server [implementations][tus implementations] of the tus
protocol out there for various languages; in our case we're interested in
**[tus-ruby-server]**.

### tus-ruby-server + shrine-tus

Tus-ruby-server is implemented using the Roda web framework, and can be mounted
inside any Rack-based web framework (including Rails) or you can run it
standalone. For simplicity we'll just mount it inside our main app, but for best
performance it's recommended to run it standalone on [Goliath]. We'll also use
the [shrine-tus] gem to enable attaching files that were uploaded to
tus-ruby-server.

```rb
# Gemfile
gem "tus-server", "~> 2.0"
gem "shrine-tus", "~> 1.0"
```
```rb
require "shrine/storage/tus"
require "shrine/storage/s3"

Shrine.storages = {
  cache: Shrine::Storage::Tus.new,
  store: Shrine::Storage::S3.new(...),
}
```
```rb
# config/routes.rb
Rails.application.routes.draw do
  mount Tus::Server => "/files"
end
```

The idea is that on the client side we'll upload files directly to the
tus-ruby-server instance, which uses its own storage ([filesystem][tus
filesystem] by default, but can also be configured to use [S3][tus s3]). Once
the file has been successfully uploaded to tus-ruby-server, we would submit its
tus URL as the attachment, which Shrine would then use to download the file
from the tus server, perform any user-defined processing, and upload the file
to permanent Shrine storage (preferrably in a [background job][shrine
backgrounding]). In other words, tus-ruby-server would be an endpoint that
saves uploads to temporary storage, just like with regular direct uploads.

At first it might sound that taking all that effort to upload the file to
tus-ruby-server is a bit pointless if the app will just end up downloading and
re-uploading it to another storage anyway. However, server side uploading will
be orders of magnitude faster and more reliable, because servers have internet
connections with much bigger bandwidth and more stability than your users will
(and if that's not enough, shrine-tus can also do a [smart copy directly from
the tus storage][shrine-tus copy]). Also, you need be able to periodically
[clear expired or unfinished uploads][tus expiration], which wouldn't be
possible if tus-ruby-server and Shrine used the same storage.

### Client side

On the client side Uppy has our backs again with the [Tus] plugin (instead of
XHRUpload or AwsS3), which internally uses [tus-js-client]. We need to give the
Tus plugin the URL to our tus server, and after the upload we need to construct
the uploaded file data as we did with direct uploads to S3.

```js
// ... other plugins ...

uppy.use(Uppy.Tus, {
  endpoint: 'http://localhost:9000/'
})

uppy.on('upload-success', function (file, data) {
  var uploadedFileData = JSON.stringify({
    id: data.url, // Shrine will later use this tus URL to download the file
    storage: "cache",
    metadata: {
      filename:  file.name,
      size:      file.size,
      mime_type: file.type,
    }
  })

  // ...
})
```

That's it, now uploads will automagically be resumed in case of temporary
failures, without the user even knowing something happened.

### AWS S3 Multipart

The tus approach has the advantages of abstracting away the underlying storage,
and the fact that there are lots of client and server implementations in
various languages to choose from. But one downside is that you're receiving
these uploads, so it's your responsibility to scale when the traffic increases.

If you would like your storage service to handle the uploads and don't mind
extra coupling to AWS S3, you can do multipart uploads directly to S3 using
Uppy's [AwsS3Multipart] plugin. That plugin requires certain endpoints that are
implemented by the [Uppy Companion] app, but you can use the
[uppy-s3_multipart] gem which implements these endpoints in Ruby, and allows
you to mount them into any Rack app.

First we'll add `uppy-s3_multipart` to the Gemfile, load the Shrine plugin and
mount the Rack app:

```rb
# Gemfile
gem "uppy-s3_multipart"
```
```rb
require "shrine/storage/s3"

Shrine.storages = {
  cache: Shrine::Storage::S3.new(prefix: "cache", **options),
  store: Shrine::Storage::S3.new(**options),
}

Shrine.plugin :uppy_s3_multipart
```
```rb
Rails.application.routes.draw do
  mount Shrine.uppy_s3_multipart(:cache) => "/s3"
end
```

We'll also need to update our S3 bucket's [CORS configuration][aws-s3-multipart
cors] to allow for client side uploads. Then we can configure Uppy's
`AwsS3Multipart` plugin:

```js
// ... other plugins ...

uppy.use(Uppy.AwsS3Multipart, {
  serverUrl: '' // uses relative URLs (pass 'https://your-app.com' for absolute URLs)
})

uppy.on('upload-success', function (file, data, uploadURL) {
  var uploadedFileData = JSON.stringify({
    id: uploadURL.match(/\/cache\/([^\?]+)/)[1], // extract key without prefix
    storage: 'cache',
    metadata: {
      size:      file.size,
      filename:  file.name,
      mime_type: file.type,
    }
  })

  // ...
})
```

Now you have direct uploads to S3 which are also resumable.

## Conclusion

Uploading files asynchronously greatly improves the user experience, and there
are many ways to do that, each suitable for different requirements (storage,
filesize etc). In order to implement direct uploads, both the client and the
server side need to do their part.

Regardless of whether you're just uploading to a simple endpoint in your app,
directly to cloud, or doing something as advanced as resumable uploads, with
Shrine & Uppy the setup is streamlined and is basically just a matter of
swapping plugins.

In the next post I will talk about using background jobs with Shrine, so stay
tuned!

## Links

* Demo with direct upload to app and S3 -- [Roda][roda demo] & [Rails][rails demo]
* Demo with resumable upload -- [Roda][resumable demo]

[Shrine]: https://github.com/shrinerb/shrine
[jQuery-File-Upload]: https://blueimp.github.io/jQuery-File-Upload/
[Dropzone.js]: http://www.dropzonejs.com
[FineUploader]:https://fineuploader.com
[Uppy]: https://uppy.io
[tus]: https://tus.io
[upload_endpoint]: http://shrinerb.com/rdoc/classes/Shrine/Plugins/UploadEndpoint.html
[XHRUpload]: https://uppy.io/docs/xhrupload/
[presign_endpoint]: http://shrinerb.com/rdoc/classes/Shrine/Plugins/UploadEndpoint.html
[AwsS3]: https://uppy.io/docs/aws-s3/
[shrine-google_cloud_storage]: https://github.com/renchap/shrine-google_cloud_storage
[shrine-cloudinary]: https://github.com/shrinerb/shrine-cloudinary#direct-uploads
[shrine-transloadit]: https://github.com/shrinerb/shrine-transloadit#direct-uploads
[carrierwave direct]: https://github.com/dwilkie/carrierwave_direct
[paperclip direct]: https://devcenter.heroku.com/articles/direct-to-s3-image-uploads-in-rails
[tus demo]: https://tus.io/demo.html
[tus-ruby-server]: https://github.com/janko-m/tus-ruby-server
[tus-js-client]: https://github.com/tus/tus-js-client
[Goliath]: https://github.com/postrank-labs/goliath
[Tus]: https://uppy.io/docs/tus/
[shrine-tus]: https://github.com/shrinerb/shrine-tus
[tus-js-client]: https://github.com/tus/tus-js-client
[tus filesystem]: https://github.com/janko-m/tus-ruby-server#filesystem
[tus s3]: https://github.com/janko-m/tus-ruby-server#amazon-s3
[tus expiration]: https://github.com/janko-m/tus-ruby-server#expiration
[shrine backgrounding]: http://shrinerb.com/rdoc/classes/Shrine/Plugins/Backgrounding.html
[shrine-tus copy]: https://github.com/shrinerb/shrine-tus#approach-c-tus-storage-equals-shrine-storage
[tus protocol]: https://tus.io/protocols/resumable-upload.html
[roda demo]: https://github.com/shrinerb/shrine/tree/master/demo
[rails demo]: https://github.com/erikdahlstrand/shrine-rails-example
[resumable demo]: https://github.com/shrinerb/shrine-tus-demo
[tus implementations]: https://tus.io/implementations.html
[refile javascript]: https://github.com/refile/refile/blob/master/app/assets/javascripts/refile.js
[activestorage javascript]: https://github.com/rails/rails/tree/master/activestorage/app/javascript/activestorage
[aws-s3 cors]: https://uppy.io/docs/aws-s3/#S3-Bucket-configuration
[AwsS3Multipart]: https://uppy.io/docs/aws-s3-multipart/
[Uppy Companion]: https://uppy.io/docs/companion/
[uppy-s3_multipart]: https://github.com/janko-m/uppy-s3_multipart
[aws-s3-multipart cors]: https://uppy.io/docs/aws-s3-multipart/#S3-Bucket-Configuration
