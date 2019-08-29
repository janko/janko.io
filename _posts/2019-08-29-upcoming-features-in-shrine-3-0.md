---
title: Upcoming Features in Shrine 3.0
tags: ruby gem upload attachment processing orm backgrounding persistence
---

The last couple of months I've been working hard to prepare for [Shrine 3.0],
which I expect will be released by the end of October. A lot of work has gone
into it, including some big but much needed rewrites. I feel the API has
stabilized now, so I thought it would be a good time to share with your some of
the new features and improvements that will be coming to 3.0. :tada:

For those who don't know, [Shrine] is a versatile file attachment library for
Ruby applications. It was born out of frustration for not being able to achieve
the desired user experience with existing solutions. Tomorrow it will be
turning 4 years old.

Before we start, here is a little refresher on Shrine's core classes:

| Class                  | Description                          |
| :--                    | :--                                  |
| `Shrine`               | performs uploads                     |
| `Shrine::UploadedFile` | represents uploaded file             |
| `Shrine::Attacher`     | handles attaching                    |
| `Shrine::Attachment`   | model wrapper for `Shrine::Attacher` |

## Decoupling from models

Currently, when attaching files, Shrine requires you to provide a mutable
struct (aka "model") which the attached file data will be written to:

```rb
class Photo < Struct.new(:image_data)
end
```
```rb
photo = Photo.new

attacher = Shrine::Attacher.new(photo, :image)
attacher.assign(file) # uploads file

photo.image_data #=> '{"id":"abc123.jpg", "storage":"cache", "metadata":{...}}'
```

This works nicely with Active Record, Sequel, Mongoid and all other database
libraries that implement the [Active Record pattern].

However, it so happens that not all Ruby database libraries implement this
pattern. [ROM] and [Hanami::Model] implement the [Repository pattern], which
separates data from persistence. Using this pattern, record objects (aka
"entities") are represented with *immutable* structs:

```rb
class Photo < Hanami::Entity
end
```
```rb
photo = Photo.new(image_data: nil)

attacher = Shrine::Attacher.new(photo, :image)
attacher.assign(file) #~> NoMethodError: undefined method `image_data=' for #<Photo>
```

You could somehow [hack your way around it][hanami-shrine hack], but this is
far from ideal. Even if I didn't care about ROM and Hanami::Model, I did feel
that coupling to model instances made the `Shrine::Attacher` implementation
more difficult to reason about. When that reached a point where we
[couldn't][derivatives 1] [implement][derivatives 2] the new
[derivatives](#derivatives) feature, I knew that attaching logic needed to be
rewritten.

The result of that rewrite is that the `Shrine::Attacher` API is now layered
into [base](#base), [column](#column), [entity](#entity), and [model](#model).

### Base

The core `Shrine::Attacher` is now instantiated standalone and maintains its
own state:

```rb
attacher = Shrine::Attacher.new
attacher.assign(file) # uploads file
attacher.file #=> #<Shrine::UploadedFile @id="abc123.jpg" @storage_key=:store ...>
```

It provides the `#data` method which returns attached file data as a
serializable Hash, suitable for persisting:

```rb
attacher.data #=>
# {
#   "id" => "abc123.jpg",
#   "storage" => "store",
#   "metadata" => {
#     "size" => 9534842,
#     "filename" => "nature.jpg",
#     "mime_type" => "image/jpeg",
#   }
# }
```

The attachment can then be loaded back from this data:

```rb
attacher = Shrine::Attacher.from_data(data)
attacher.file #=> #<Shrine::UploadedFile @id="abc123.jpg" @storage_key=:store ...>
```

### Column

Now, if you want to persist the attached file data to a text database column,
you'll need to **serialize** the data hash into a string (e.g. JSON). For that
you can use the `column` plugin:

```rb
Shrine.plugin :column
```
```rb
data = attacher.column_data # dump JSON string
#=> '{"id":"abc123.jpg","storage":"store","metadata":{...}}'
```
```rb
attacher = Shrine::Attacher.from_column(data) # load JSON string
attacher.file #=> #<Shrine::UploadedFile @id="abc123.jpg" @storage_key=:store ...>
```

### Entity

The `entity` plugin builds upon the `column` plugin, providing integration for
**immutable** structs:

```rb
class Photo < Hanami::Entity
end
```
```rb
photo = Photo.new(image_data: nil)

# allows instantiating attacher from an entity
attacher = Shrine::Attacher.from_entity(photo, :image)
attacher.assign(file) # does not attempt to write to the entity attribute

# provides the hash of attributes for you to persist
attacher.column_values #=> { :image_data => '{"id":"abc123.jpg","storage":"cache","metadata":{...}}' }
```

You can remove some of the boilerplate with the `Shrine::Attachment` module:

```rb
class Photo < Hanami::Entity
  include Shrine::Attachment(:image)
end
```
```rb
photo = Photo.new(image_data: '{"id":"abc123.jpg","storage":"store","metadata":{...}}')
photo.image #=> #<Shrine::UploadedFile @id="abc123.jpg" @storage_key=:store ...>
photo.image_attacher # shorthand for `Shrine::Attacher.from_entity(photo, :image)`
```

The upcoming `shrine-rom` gem will build upon the `entity` plugin, as well as
the [`hanami-shrine`][hanami-shrine] gem.

### Model

With the `entity` plugin providing the reads, the new `model` plugin adds the
writes, which is convenient for **mutable** structs:

```rb
class Photo < Struct.new(:image_data)
end
```
```rb
photo = Photo.new

# allows instantiating attacher from a model
attacher = Shrine::Attacher.from_model(photo, :image)
attacher.assign(file) # writes uploaded file data to the model attribute

photo.image_data #=> #=> '{"id":"abc123.jpg", "storage":"cache", "metadata":{...}}'
```

Or with the `Shrine::Attachment` module:

```rb
class Photo < Struct.new(:image_data)
  include Shrine::Attachment(:image)
end
```
```rb
photo = Photo.new
photo.image = file
photo.image #=> #<Shrine::UploadedFile @id="abc123.jpg" @storage_key=:cache ...>
photo.image_data #=> #=> '{"id":"abc123.jpg", "storage":"cache", "metadata":{...}}'
```

The existing [`activerecord`][activerecord] and [`sequel`][sequel] plugins are
then built on top of the `model` plugin.

## Derivatives

The `Shrine::Attacher` rewrite also enabled us to implement the main new
feature – the [**derivatives**][derivatives] plugin. It is a reimplementation
of the existing [`versions`][versions] plugin, but with a proper API and much
needed flexibility.

### Problems with versions

The `versions` plugin works in a way that you register a processing block,
which receives the original cached file and needs to return the set of files
that should be saved. This block is automatically triggered when the cached
file is being uploaded to permanent storage.

```rb
class ImageUploader < Shrine
  plugin :processing
  plugin :versions

  process(:store) do |io|
    processor = ImageProcessing::MiniMagick.source(io.download)

    { original: io,
      large:    processor.resize_to_limit!(800, 800),
      medium:   processor.resize_to_limit!(500, 500),
      small:    processor.resize_to_limit!(300, 300) }
  end
end
```
```rb
photo.image = file
photo.save  # triggers processing of versions
photo.image #=>
# {
#   original: <Shrine::UploadedFile @id="original.jpg" ...>,
#   large:    <Shrine::UploadedFile @id="large.jpg" ...>,
#   medium:   <Shrine::UploadedFile @id="medium.jpg" ...>,
#   small:    <Shrine::UploadedFile @id="small.jpg" ...>,
# }
```

One problem with this design is that you needed to change how you access your
original file after the versions has been processed. This is especially
problematic when processing in a [background job][backgrounding], as then you
need to handle both attachment states, with and without versions.

```rb
# how we access the original file...
photo.image #=> #<Shrine::UploadedFile @id="original.jpg" ...>
photo.image.mime_type #=> "image/jpeg"

photo.save

# ...now needs to be changed
photo.image[:original] #=> #<Shrine::UploadedFile @id="original.jpg" ...>
photo.image[:original].mime_type #=> "image/jpeg"
```

The fact that processing versions was tied to promotion made other things
difficult as well:

* uploading versions to a different storage than the original file
* adding new versions to an existing attachment
* reprocessing existing versions

### Solution

With the new **derivatives** plugin, you trigger processing explicitly when you
want, and processed files are retrieved separately from the original file:

```rb
class ImageUploader < Shrine
  plugin :derivatives

  Attacher.derivatives_processor :thumbnails do |original|
    processor = ImageProcessing::MiniMagick.source(original)

    {
      large:  processor.resize_to_limit!(800, 800),
      medium: processor.resize_to_limit!(500, 500),
      small:  processor.resize_to_limit!(300, 300),
    }
  end
end
```
```rb
photo.image = file
photo.image_derivatives #=> {}

photo.image_derivatives!(:thumbnails) # triggers processing and uploads results
photo.image_derivatives #=>
# {
#   large:  #<Shrine::UploadedFile @id="large.jpg" @storage_key=:store>,
#   medium: #<Shrine::UploadedFile @id="medium.jpg" @storage_key=:store>,
#   small:  #<Shrine::UploadedFile @id="small.jpg" @storage_key=:store>,
# }

# original file is still accessed in the same way
photo.image #=> #<Shrine::UploadedFile @id="original.jpg" ...>
```

The processing block is just a convention, we can also add files directly using
`Attacher#add_derivative(s)`:

```rb
attacher = photo.image_attacher
attacher.derivatives #=> { small: ..., medium: ..., large: ... }
attacher.add_derivative(:extra_large, extra_large_file) # uploads file and merges result
attacher.derivatives #=> { small: ..., medium: ..., large: ..., extra_large: ... }
```

The storage where processed files will be uploaded to can now be changed as
well:

```rb
# upload all derivatives to :thumbnail_store
plugin :derivatives, storage: :thumbnail_store

# upload different derivatives to different storage
plugin :derivatives, storage: -> (name) { ... }
```

## Backgrounding

Shrine's [`backgrounding`][backgrounding] plugin allows you to delay uploading
cached file to permanent storage and file processing into a background job.
Previously, it tried to do everything for you – fetch the record in the
background job, perform processing, reload the record to check that the
attachment hasn't changed – which meant when something [wouldn't][backgrounding
1] [work][backgrounding 2], you had very little visibility as to why.

```rb
Shrine.plugin :backgrounding
Shrine::Attacher.promote_block { |data| PromoteJob.perform_async(data) } # magic hash
```
```rb
class PromoteJob < ActiveJob::Base
  def perform(data)
    Shrine::Attacher.promote(data) # use the magic hash to do magic things
  end
end
```

For Shrine 3.0, the backgrounding feature has been completely rewritten to be
more explicit and flexible:

```rb
Shrine.plugin :backgrounding
Shrine::Attacher.promote_block { PromoteJob.perform_async(record, name, file_data) }
```
```rb
class PromoteJob < ActiveJob::Base
  def perform(record, name, file_data)
    attacher = Shrine::Attacher.retrieve(model: record, name: name, file: file_data)
    attacher.atomic_promote
  rescue Shrine::AttachmentChanged, ActiveRecord::RecordNotFound
  end
end
```

You can now see what's going on:

1. record, attachment name, and current attached file are passed to the background job
2. background job fetches the database record (ActiveJob does this automatically)
3. you retrieve the attacher as it was before the background job was spawned
  - if attachment has changed, `Shrine::AttachmentChanged` is raised
4. you upload the cached attached file to permanent storage
  - if attachment has changed during upload, `Shrine::AttachmentChanged` is raised
  * if record has been deleted, `ActiveRecord::RecordNotFound` is raised

It's now easy for example to adding processing [derivatives](#derivatives) into
the mix:

```rb
def perform(record, name, file_data)
  attacher = Shrine::Attacher.retrieve(model: record, name: name, file: file_data)
  attacher.create_derivatives(:thumbnails) # process derivatives and store results
  attacher.atomic_promote
rescue Shrine::AttachmentChanged, ActiveRecord::RecordNotFound
end
```

People have also wanted to pass additional parameters from the controller into
the background job. You can now do this with instance-level hooks:

```rb
class PhotosController < ApplicationController
  def create
    photo = Photo.new(photo_params)

    photo.image_attacher.promote_block do |attacher|
      # explicit style without instance eval
      PromoteJob.perform_async(
        attacher.record,
        attacher.name,
        attacher.file_data,
        current_user, # pass current user
      )
    end

    photo.save # background job is spawned
  end
end
```

## Other improvements

In addition to these big rewrites, there have been many other notable
improvements in areas of usability, performance and design. Here are some of
the highlights:

### Skipping temporary storage

Shrine uses a temporary storage for storing files that have not been attached
yet. This enables features such as retaining uploads on validation errors and
[direct uploads].

However, if you're attaching files from a background job or a script, you don't
need the temporary storage. Starting from Shrine 3.0, you won't need to have
temporary storage defined, and you can change attachment writer method to
upload directly to permanent storage:

```rb
Shrine.plugin :model, cache: false
```
```rb
photo.image = file
photo.image.storage_key #=> :store (permanent storage)
```

### Faster file retrieval

Currently, whenever the attached file is accessed, it's parsed from the
attachment data attribute on the record instance. This can add up if you're
storing lots of processed files or metadata.

```rb
photo.image # parses `image_data` column attribute
photo.image # parses `image_data` column attribute again
```

Starting from Shrine 3.0, the attached file will be loaded from the data
attribute only on first access. Additionally, you'll be able to switch to a
faster JSON parser if you want to.

```rb
require "oj" # https://github.com/ohler55/oj
Shrine.plugin :column, serializer: Oj
```
```rb
photo.image # parses `image_data` using Oj, and memoizes the result
photo.image # returns memoized file
```

### Standardized persistence API

The persistence API has now been standardized across different persistence
plugins:

| Method                    | Description                                           |
| :-----                    | :----------                                           |
| `Attacher#persist`        | persists attachment data                              |
| `Attacher#atomic_persist` | persists attachment data if attachment hasn't changed |
| `Attacher#atomic_promote` | promotes cached file and atomically persists changes  |

All persistence plugins will now share this API:

* `activerecord`
* `sequel`
* `mongoid`
* `rom`
* `hanami`
* ...

This will make it easier for 3rd-party plugins to be agnostic to your
persistence backend, as they'll be able to just call `Attacher#persist` and
know it will do the right thing. It even works if the user has multiple
persistence plugins loaded simultaneously.

## Conclusion

I still stand strong by the decision that Shrine will never paint you into a
corner, regardless of which database library and web framework you're using, or
which design patterns you prefer. At times following this philosophy can be
very challenging, but ultimately it's very rewarding, because you know you've
ended up with a design that's really solid. :muscle:

I've released `3.0.0.beta` with these new changes, so if you want you can
already use them:

```sh
$ gem install --pre shrine
Successfully installed shrine-3.0.0.beta
```

I still need to finish up the backwards compatibility layer, write the
upgrading guide and full release notes, as well as finish updating the
documentation and other `shrine-*` gems. Once that's done, Shrine 3.0 should be
out the doors. :sparkles:

[Shrine 3.0]: https://github.com/shrinerb/shrine/blob/d7ab678dacb3418ee67f6495f8f934107c130dd1/CHANGELOG.md#readme
[Shrine]: https://shrinerb.com/
[direct uploads]: https://github.com/shrinerb/shrine#direct-uploads
[Active Record pattern]: https://www.martinfowler.com/eaaCatalog/activeRecord.html
[activerecord]: https://github.com/shrinerb/shrine/blob/master/doc/plugins/activerecord.md
[sequel]: https://github.com/shrinerb/shrine/blob/master/doc/plugins/sequel.md
[ROM]: https://rom-rb.org/
[Hanami::Model]: https://github.com/hanami/model
[Repository pattern]: https://martinfowler.com/eaaCatalog/repository.html
[hanami-shrine]: https://github.com/katafrakt/hanami-shrine
[hanami-shrine hack]: https://github.com/katafrakt/hanami-shrine/blob/de69815c6a609e87bb524c0a865cd46585bc30cb/lib/shrine/plugins/hanami.rb#L12-L40
[versions]: https://github.com/shrinerb/shrine/blob/master/doc/plugins/versions.md#readme
[derivatives]: https://github.com/shrinerb/shrine/blob/master/doc/plugins/derivatives.md#readme
[derivatives 1]: https://github.com/shrinerb/shrine/pull/295
[derivatives 2]: https://github.com/shrinerb/shrine/pull/299
[backgrounding]: https://github.com/shrinerb/shrine/blob/master/doc/plugins/backgrounding.md#readme
[backgrounding 1]: https://github.com/shrinerb/shrine/issues/236
[backgrounding 2]: https://github.com/shrinerb/shrine/issues/333
