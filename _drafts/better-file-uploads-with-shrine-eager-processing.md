---
title: "Better File Uploads with Shrine: Eager Processing"
excerpt: "This is the 7th part of a series of blog posts about Shrine. In this
  part we will dive deeper into Shrine's eager processing feature, showing some
  interesting use cases that are possible thanks to its advanced API."
tags: ruby file attachment upload shrine library gem
series: better-file-uploads-with-shrine
---

*This article is part of the "Better File Uploads with Shrine" series.*

In the [Processing](/better-file-uploads-with-shrine-processing) article, we
gave an introduction on what is generally possible with [Shrine] in terms of
file processing. In this article I would like to go deeper into Shrine's
[**eager processing**][derivatives] feature, showing some interesting use cases
that are possible thanks to its advanced API.

First off, I chose the term "*eager* processing" to describe the process of
generating a pre-defined set of processed files (e.g. image thumbnails, encoded
videos) and saving them alongside the main file. Paperclip and CarrierWave use
this processing strategy. This is in contrast to "*on-the-fly* processing",
where processing happens lazily when the file is requested, which is the
strategy used by Active Storage, Refile and Dragonfly (and which [Shrine
supports as well][derivation_endpoint]).

When I used [Paperclip][Paperclip styles] and [CarrierWave][CarrierWave
versions], I was never fond of their processing implementation. The class-level
DSLs don't provide much flexibility for things such as dynamic versions,
sharing objects during processing, or parallelizing processing. The processors
themselves are coupled to the attachment context, which increases complexity
and [encourages creating library-specific extensions][carrierwave extensions].
Also, moving processing to a background job is far from straightforward
([delayed_paperclip] and [carrierwave_backgrounder] are pretty complex).

## Derivatives

While building Shrine, I wanted to take the opportunity to solve these
limitations, and build the API I wish I had. The [first attempt][versions
plugin] wasn't quite as successful, but I've learned a lot from it, and the
[next attempt][versions rewrite] resulted in what we can see today:

```rb
class ImageUploader < Shrine
  Attacher.derivatives do |original|
    magick = ImageProcessing::MiniMagick.source(original)

    { large:  magick.resize_to_limit!(800, 800),
      medium: magick.resize_to_limit!(500, 500),
      small:  magick.resize_to_limit!(300, 300) }
  end
end
```
```rb
class Photo < Sequel::Model
  include ImageUploader::Attachment(:image)
end
```
```rb
photo = Photo.create(image: file)
photo.image_url(:large)  #=> nil
photo.image_derivatives! # create derivatives
photo.image_url(:large)  #=> "https://my-bucket.s3.amazonaws.com/path/to/large.jpg"
```

How it works is that your processing block is called with the original file,
inside which you can perform processing in any way you like (in this example
we're using the [ImageProcessing] gem), and then the processed files returned
by the block are uploaded to the storage.

The implementation *doesn't* rely on [in-place processing][carrierwave
in-place], [intermediary state mutation][paperclip state], or [unnecessary
processor abstractions][paperclip processor].

## Layered API

The derivatives creation API is built on top of lower level methods, each of
which you can use standalone. This kind of layered API opens up a lot of
possibilities, as we'll see in the next section.

### Create derivatives

On the top level we have `Attacher#create_derivatives` (in our example that's
`photo.image_derivatives!`), which triggers processing and stores processed
files:

```rb
attacher.attach(io)
attacher.create_derivatives
attacher.derivatives #=>
# {
#    large: #<Shrine::UploadedFile id="74dbd2dd.jpg" storage=:store metadata={...}>,
#    medium: #<Shrine::UploadedFile id="92144e77.jpg" storage=:store metadata={...}>,
#    small: #<Shrine::UploadedFile id="04165c6c.jpg" storage=:store metadata={...}>,
# }
```

### Process derivatives

The `Attacher#process_derivatives` method executes our processing block with
the downloaded attached file:

```rb
attacher.attach(io)
attacher.process_derivatives #=>
# {
#   large: #<File:/tmp/.../path/to/large.jpg>,
#   medium: #<File:/tmp/.../path/to/medium.jpg>,
#   small: #<File:/tmp/.../path/to/small.jpg>,
# }
```

### Add derivatives

The `Attacher#add_derivatives` method uploads and saves given files:

```rb
attacher.add_derivatives(
  large:  File.open("/path/to/large.jpg",  "rb"),
  medium: File.open("/path/to/medium.jpg", "rb"),
  small:  File.open("/path/to/small.jpg",  "rb"),
)

attacher.derivatives #=>
# {
#    large: #<Shrine::UploadedFile id="74dbd2dd.jpg" storage=:store metadata={...}>,
#    medium: #<Shrine::UploadedFile id="92144e77.jpg" storage=:store metadata={...}>,
#    small: #<Shrine::UploadedFile id="04165c6c.jpg" storage=:store metadata={...}>,
# }
```

### Upload derivatives

The `Attacher#upload_derivatives` only uploads given files:

```rb
derivatives = attacher.upload_derivatives(
  large:  File.open("/path/to/large.jpg",  "rb"),
  medium: File.open("/path/to/medium.jpg", "rb"),
  small:  File.open("/path/to/small.jpg",  "rb"),
)

derivatives #=>
# {
#    large: #<Shrine::UploadedFile id="74dbd2dd.jpg" storage=:store metadata={...}>,
#    medium: #<Shrine::UploadedFile id="92144e77.jpg" storage=:store metadata={...}>,
#    small: #<Shrine::UploadedFile id="04165c6c.jpg" storage=:store metadata={...}>,
# }
```

### Merge derivatives

The `Attacher#merge_derivatives` method adds given uploaded files to the
collection:

```rb
attacher.merge_derivatives(
  large:  Shrine.uploaded_file(id: "74dbd2dd.jpg", storage: :store, metadata: { ... }),
  medium: Shrine.uploaded_file(id: "92144e77.jpg", storage: :store, metadata: { ... }),
  small:  Shrine.uploaded_file(id: "04165c6c.jpg", storage: :store, metadata: { ... }),
)

attacher.derivatives #=> { large: ..., medium: ..., small: ... }

attacher.merge_derivatives(
  sepia: Shrine.uploaded_file(id: "c1d7b25e.jpg", storage: :store, metadata: { ... }),
  gray:  Shrine.uploaded_file(id: "f2661456.jpg", storage: :store, metadata: { ... }),
)

attacher.derivatives #=> { large: ..., medium: ..., small: ..., sepia: ..., gray: ... }
```

### Set derivatives

The `Attacher#set_derivatives` method writes derivatives data to the attachment
column, so that the derivatives can later be loaded from it:

```rb
attacher.set_derivatives(derivatives)
attacher.data #=>
# {
#   "id": "e03d8b7d.jpg",
#   "storage": "store",
#   "metadata": { ... },
#   "derivatives": {
#      "large": { "id": "74dbd2dd.jpg", "storage": "store", "metadata": { ... } },
#      "medium": { "id": "92144e77.jpg", "storage": "store", "metadata": { ... } },
#      "small": { "id": "04165c6c.jpg", "storage": "store", "metadata": { ... } },
#   }
# }
```

### Overview

These methods are composed together to form a hierarchy:

* `#create_derivatives`
  - `#process_derivatives`
  - `#add_derivatives`
    - `#upload_derivatives`
    - `#merge_derivatives`
      - `#set_derivatives`

## Use cases

I think the best way to show the flexibility of Shrine's derivatives API is by
showing specific use cases that might come up when building your app.

### A. Image cropping

Let's say we want to create a set of image thumbnails, but from a cropped
version of the original. This is how we might implement this processing:

```rb
class ImageUploader < Shrine
  Attacher.derivatives do |original, crop: nil|
    magick = ImageProcesing::MiniMagick.source(original)
    magick = magick.crop("#{crop[:w]}x#{crop[:h]}+#{crop[:x]}+#{crop[:y]}") if crop

    {
      large:  magick.resize_to_limit!(800, 800),
      medium: magick.resize_to_limit!(500, 500),
      small:  magick.resize_to_limit!(300, 300),
    }
  end
end
```
```rb
photo.image_derivatives!(crop: { x: 0, y: 0, w: 300, h: 300 })
```

With CarrierWave we'd need to [add virtual attributes for cropping][railscast
cropping] to our model, which increases coupling, whereas with Shrine we were
able to just pass the cropping parameters directly to the processor block.

### B. PDF splitting

Let's say we're accepting PDFs and we want to extract individual pages. We can
do this by saving each page into a file and returning them at the end of the
process block:

```rb
class PdfUploader < Shrine
  Attacher.derivatives do |original|
    page_count = MiniMagick::Image.new(original.path).pages.count

    pages = (0...page_count).map do |page_number|
      ImageProcessing::MiniMagick
        .source(original)
        .loader(page: page_number)
        .convert!("jpeg")
    end

    { pages: pages }
  end
end
```
```rb
music_sheet = MusicSheet.create(file: pdf_file)
music_sheet.file_derivatives! # create pages
music_sheet.file_derivatives[:pages] #=>
# [
#   #<Shrine::UploadedFile id="b8725d50300a2f5a.jpg" ...>, (page 1)
#   #<Shrine::UploadedFile id="e2f75c340e393539.jpg" ...>, (page 2)
#   #<Shrine::UploadedFile id="8da9204d26cc3f73.jpg" ...>, (page 3)
#   ...
#   #<Shrine::UploadedFile id="c4b0a7e396afff4d.jpg" ...>, (page n)
# ]
```

Since this type of processing produces a variable number of files depending on
the original file, CarrierWave and Paperclip won't support this use case, as
they require declaring version names up front. In constrast, Shrine allows us
to return [any combination of hashes and arrays][shrine nesting].

### C. Processing with libvips

[libvips] is a high-performance alternative to ImageMagick. Let's say we want
to use it to speed up our processing, using the [ruby-vips] gem. This is how we
might implement thumbnail generation:

```rb
class GenerateThumbnail
  def self.call(file, width, height)
    result = Tempfile.new ["thumb-#{width}-#{height}", File.extname(file.path)]

    image = Vips::Image.thumbnail(file.path, width, height: height, size: :down)
    image.write_to_file(result.path)

    result
  end
end
```
```rb
class ImageUploader < Shrine
  THUMBNAILS = {
    xl: [1200, 1200],
    l:  [800,  800],
    m:  [500,  500],
    s:  [300,  300],
    xs: [150,  150],
  }

  Attacher.derivatives do |original|
    THUMBNAILS.transform_values do |(width, height)|
      GenerateThumbnail.call(original, width, height)
    end
  end
end
```

Notice how our processing code is neatly encapsulated in a PORO, agnostic to
which file upload library we're using. By the way, the ImageProcessing gem
already comes with a [libvips backend][ImageProcessing::Vips] for maximum
convenience :wink:.

### D. Conditional processing

Sometimes we need to apply different processing options based on the type of
the source file. Since the derivatives block is invoked at the time of
processing, we can use regular conditionals for this:

```rb
class ImageUploader < Shrine
  plugin :type_predicates, methods: %i[jpeg svg webp]

  Attacher.derivatives do |original|
    magick = ImageProcessing::MiniMagick.source(original)

    # convert SVG to PNG
    magick = magick.loader(transparent: "white").convert("png") if file.svg?
    # produce progressive JPEGs
    magick = magick.saver(interlace: "JPEG", quality: 90) if file.jpeg?
    # use lossless WEBP compression
    magick = magick.saver(define: { webp: { lossless: true } }) if file.webp?

    { thumbnail: magick.resize_to_limit!(800, 800) }
  end
end
```
```sh
convert -transparent white input.svg -resize 800x800> output.png           # for SVG
convert input.jpg -resize 800x800> -interlace JPEG -quality 90 output.jpg  # for JPEG
convert input.webp -resize 800x800> -define webp:lossless=true output.webp # for WEBP
```

### E. Backgrounding

Moving processing into a background job is useful for maintaining our request
throughput and for handling retries. Since with Shrine processing is triggered
explicitly, we can just move the processing call from the controller into the
background worker:

```rb
Shrine.plugin :backgrounding
Shrine::Attacher.promote_block { PromoteJob.perform_later(record, name, file_data) }
```
```rb
class PromoteJob < ActiveJob::Base
  def perform(record, name, file_data)
    attacher = Shrine::Attacher.retrieve(model: record, name: name, file: file_data)
    attacher.create_derivatives # trigger our processing here
    attacher.atomic_promote
  rescue Shrine::AttachmentChanged, ActiveRecord::RecordNotFound
    # attachment has changed or record has been deleted, nothing to do
  end
end
```
```rb
photo = Photo.create(image: file) # spawns PromoteJob
photo.image_derivatives #=> {}
# ... background job finishes ...
photo.image_derivatives #=> { large: ..., medium: ..., small: ... }
```

Here we're piggybacking onto the background job that is spawned for promoting
the cached file to permanent storage. The `Attacher.retrieve` and
`Attacher#atomic_promote` methods are used to provide concurrency-safety,
handling the potential case of attachment changing or the record being deleted
during processing, and making sure any orphan files are deleted.

## In closing

For times when on-the-fly processing isn't suitable, having a flexible eager
processing API can really make life simpler. I believe Shrine's take on this is
a big improvement over what other file attachment libraries have to offer.

The next article I plan to write will be about Shrine's [on-the-fly
processing][derivation_endpoint], so stay tuned.

[Shrine]: https://github.com/shrinerb/shrine
[derivatives]: https://shrinerb.com/docs/plugins/derivatives
[derivation_endpoint]: https://shrinerb.com/docs/plugins/derivation_endpoint
[Paperclip styles]: https://github.com/thoughtbot/paperclip#post-processing
[CarrierWave versions]: https://github.com/carrierwaveuploader/carrierwave#adding-versions
[versions plugin]: https://github.com/shrinerb/shrine/blob/61f36a6edda6e4654b30e78d16485c9e79a2c31f/doc/plugins/versions.md#readme
[versions rewrite]: https://twin.github.io/upcoming-features-in-shrine-3-0/#derivatives
[delayed_paperclip]: https://github.com/jrgifford/delayed_paperclip
[carrierwave_backgrounder]: https://github.com/lardawge/carrierwave_backgrounder
[libvips]: https://libvips.github.io/libvips/
[ruby-vips]: https://github.com/libvips/ruby-vips
[ImageProcessing]: https://github.com/janko/image_processing
[concurrent-ruby]: https://github.com/ruby-concurrency/concurrent-ruby
[railscast cropping]: http://railscasts.com/episodes/182-cropping-images-revised
[derivatives nesting]: https://shrinerb.com/docs/plugins/derivatives#nesting-derivatives
[carrierwave extensions]: https://github.com/carrierwaveuploader/carrierwave/wiki#add-ons
[ImageProcessing::Vips]: https://github.com/janko/image_processing/blob/master/doc/vips.md#usage
[shrine nesting]: https://shrinerb.com/docs/plugins/derivatives#nesting-derivatives
[type_predicates]: https://shrinerb.com/docs/plugins/type_predicates
[carrierwave in-place]: https://github.com/carrierwaveuploader/carrierwave/blob/712f4050913603be3a264dd114e162f3e3821727/lib/carrierwave/processing/mini_magick.rb#L305-L311
[paperclip state]: https://github.com/thoughtbot/paperclip/blob/6661480c5b321709ad44c7ef9572d7f908857a9d/lib/paperclip/attachment.rb#L536
[paperclip processor]: https://github.com/thoughtbot/paperclip/blob/6661480c5b321709ad44c7ef9572d7f908857a9d/lib/paperclip/processor.rb#L21
