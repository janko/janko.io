---
title: Asynchronous File Uploads
tags: ruby web file upload backgrounding
---

Accepting file uploads in web applications is very delicate, because all
actions for dealing with attachments are slow:

* uploading files to your app
* uploading files to an external storage
* file processing
* deleting files

A vanilla file upload implementation where all of this is synchronous has two
main downsides: (a) the UI is blocked during these actions, (b) your
application's throughput is reduced.

Even if through some miracle you only have to deal with plaintext files, you
will likely still start experiencing these problems when your user traffic
increases. Synchronous uploads were acceptable in early ages of web, but today
we're better than that.

## Theory

Generally the optimal way to implement file uploads as attachments in
applications is to have two phases: **caching** and **storing**. Before input
validation, the uploaded file is saved to a temporary location ("caching").
After validations have passed and the record is being saved, the file is taken
from the cache, is optionally processed, and it's saved into a permanent
location ("storing").

There are numerous benefits to this design, but there is one that stands out
and is the topic of this post -- it allows you to create a **completely
asynchronous file upload workflow**.

Uploading:

1. User chooses the file in the form
2. JavaScript starts caching it asynchronously (to a separate endpoint)
3. After cached file is uploaded, the form field is filled with file's identifier
4. When the form is submitted, only the identifier is sent over the wire
5. Processing and storing is kicked into a background job
6. Record saves instantaneously
7. Background job on completion updates the record with stored attachment(s)

Deleting:

1. User clicks to delete the record with an attachment
2. Deleting the file(s) is kicked into a background job
3. Record is deleted instantaneously

Even though caching of the file via AJAX still takes the same time as if it was
done synchronously on form submit, users are now much happier since their UI
isn't blocked, allowing them to do other things until the upload finishes. In
the meanwhile they ideally see a nice progress bar letting them know when the
upload will finish.

Utilizing this asynchronous workflow is crucial for good user experience and
maintaining your application's throughput. In the continuation of this post I
want take a look at existing file upload libraries and analyze their abilities
for asynchronicity, having the following criteria in mind:

* **Direct upload** -- Is it possible to implement direct (AJAX) uploads?
* **Storing** -- Can storing be put into a background job?
* **Deleting** -- Can deleting be put into a background job?
* **Simplicity** -- How easy is the setup and how transparent is the implementation?
* **Flexibility** -- How customizable is the choice of backgrounding mechanism?
* **Encapsulation** -- How gracefully can you degrade while the background job is working?
* **Thread-safety** -- Can background jobs safely run in parallel?
* **Introspection** -- How easy it is to debug background job failures?
* **Adaptation** -- Do background jobs react on state changes (e.g. record
  getting deleted)?

## Libraries

### Paperclip

Paperclip unfortunately doesn't do file caching, so there is no straightforward
way to implement direct (AJAX) upload. The main storage cannot be used for
direct uploads, because then attackers would be able to easily flood it.

For asynchronous processing there is [delayed_paperclip], which has couple of
upsides:

* most backgrounding libraries are supported, and you can use your own worker
  classes (although it isn't documented)
* the original file is available to you while the background job is working, so
  you can gracefully degrade
* you can process some styles in the foreground and some in the background
* jobs properly abort when record is missing

```ruby
class Photo < ActiveRecord::Base
  has_attached_file :image, styles: {thumb: "300x300>"}
  process_in_background :image
end
```

Unfortunately, a huge downside of delayed_paperclip is that storing the
original file cannot be put into background. This means that the user has to
wait for the file to be uploaded *twice* (first to the app, then to the
storage), before any backgrounding even takes place. And that is really slow
:snail:. You cannot even process the original file to reduce its filesize
(before the second upload), it has to be uploaded raw both times. This really
hurts your application's throughput, and database's as well; ActiveRecord wraps
record saving into a transaction, which means a transaction is open for the
whole duration of the upload!

Another big downside of delayed_paperclip is that you cannot delete files in
the background. This is might not be such a big deal when you only have a
single file, but it sure is when you have multiple styles (one HTTP request per
style).

In your views you also have to specially handle the case when the styles
haven't finished processing. And to be able to do that you need to add an
additional database column (on top of the [4 attachment columns] you already
have). However, this design doesn't handle parallel jobs well; if the user
makes two consecutive updates, it can happen that the old job upon finishing
sets the column to "not processing" while the new job is still working, which
can temporarily cause broken links.

If a background job fails because of an error, the file that caused the error
can be found only if the attachment hasn't changed in the meanwhile. Otherwise
it's necessary to either to implement context collecting for error reports, or
keep a history of record updates.

The setup of delayed_paperclip is quite complex; `ActiveRecord::Base` and
`Paperclip::Attachment` have to be extended with modules, the URL generator
needs to be replaced, a column added, and a class method called. The
[railtie](https://github.com/jrgifford/delayed_paperclip/blob/master/lib/delayed_paperclip/railtie.rb)
hides most of it away from you, but it's obvious that Paperclip wasn't
designed for backgrounding.

### CarrierWave

CarrierWave caches files before storing them, so although there isn't a
built-in endpoint for direct uploads, it probably shouldn't be too difficult to
implement your own (although only to filesystem). For direct S3 uploads there
is [carrierwave_direct], which provides an S3 form which is usable by AJAX,
although multiple file uploads are a bit tricky.

Asynchronous processing/storing is given by [carrierwave_backgrounder], which
has some upsides:

* background library support is wider than delayed_paperclip's
* the file can be both processed and stored in the background
* the cached original can be displayed to the user while background job is working

```ruby
class MyUploader < CarrierWave::Uploader::Base
  include CarrierWave::Backgrounder::Delay
end
```
```ruby
class Photo < ActiveRecord::Base
  mount_uploader :image, MyUploader
  store_in_background :image
end
```

There is no explicit support for deleting in background. Replaced files are
coincidentally deleted in new attachment's background job (a separate job for
deleting would be better), but removing the attachment or destroying the record
synchronously deletes associated files.

It requires an additional column for storing the cached file, and another
column can be added for information whether the background job is working.
However, the latter column doesn't handle parallel jobs well, same as
delayed_paperclip.

Debugging job failures is the same as delayed_paperclip's, it can only be done
if the attachment hasn't changed, or some special handling is implemented.

Setup of carrierwave_backgrounder is complex; `ActiveRecord::Base` and the
uploader classes need to be extended with modules, two columns need to be
added, and a class method called. The implementation of the library is complex
as well, a lot of metaprogramming. This complexity caused bugs like [breaking
CarrierWave's ability to remove attachments]. It's obvious that CarrierWave
wasn't designed for backgrounding.

### Dragonfly

Dragonfly does caching (the term is "retaining" here), so even though there
isn't a built-in endpoint for direct uploads, it probably shouldn't be too
difficult to implement your own (although it would require some code-digging).
However, it seems that the storage has to be the same for caching and storing,
which is a bit limiting.

Dragonfly doesn't have an extension for backgrounding. Since Dragonfly does
processing on-the-fly (not on upload), it might appear that backgrounding isn't
that important here. That can't be further from the truth. A file upload itself
still takes a lot of time, already for files like images, let alone videos or
other large files, where it's basically unusable (since a database transaction
is open during the whole upload).

The [paperdragon] gem provides a nice thin interface on top of Dragonfly,
giving it the ability to do upfront processing. It promotes explicitness, and
one of the advantages are that processing/storing/deleting can be put into
background (since they're not tied to ORM callbacks). However, with great power
comes great reponsibility; you have all the freedom you need, but you still
have to do a lot of manual work to implement it right, because you need to
take care about a lot of things (generalizing jobs for all attachments,
graceful degradation, thread-safety, introspection etc).

```ruby
file = params.delete("image")

photo = Photo.create(params)

# This can be put into background
photo.image(file) do |v|
  v.process!(:original)
  v.process!(:thumb) { |job| job.thumb!("300x300#") }
end

photo.save
```

### Refile

[Refile] ships with a complete solution for direct uploads. It comes with a
Rack endpoint for direct uploads, and has special support for direct S3 uploads.
On top of that it comes with complete plug-and-play JavaScript for hooking the
endpoint to a file field. This is a big plus for user experience.

Refile doesn't have support for storing in background, for the same reasons as
Dragonfly, because it does on-the-fly processing. If you're using S3 for both
cache and store, Refile will store the cached file by issuing an S3 COPY command
(instead of reuploading the file). This is fast, but you're still making an
HTTP request inside a transaction. There is currently an [open issue on Refile
for adding backgrounding], but it in my opinion it would require a rewrite.

### Shrine

[Shrine] is a relatively new library for file uploads. It was created to solve
limitations of existing libraries; it comes with a greater arsenal of features,
with a much simpler implementation and more flexibility.

Shrine, like Refile, ships with an endpoint for direct uploads, with special
support for direct S3 uploads. It doesn't ship with a plug-and-play JavaScript
solution, instead it encourages you to use one of the excellent JavaScript
libraries for generic file uploads.

Shrine has built-in support for putting processing/storing/deleting into a
background job. It supports any backgrounding library, because instead of
shipping with integrations for each and every backgrounding library, it simply
lets you call the background job yourself.

```ruby
Shrine.plugin :backgrounding
Shrine::Attacher.promote { |data| UploadJob.perform_async(data) }
Shrine::Attacher.delete { |data| DeleteJob.perform_async(data) }
```
```ruby
class UploadJob
  include Sidekiq::Worker
  def perform(data)
    Shrine::Attacher.promote(data)
  end
end
```
```ruby
class DeleteJob
  include Sidekiq::Worker
  def perform(data)
    Shrine::Attacher.delete(data)
  end
end
```

The `UploadJob` is triggered when the file is "promoted" (moved from cache to
store), while the `DeleteJob` is triggered when: **a)** record is destroyed, **b)**
attachment is removed, or **c)** attachment is replaced.

At first glance it might seem that the setup is more complicated than in other
solutions. However, if you observe *what* code you are required to write,
you'll notice it's actually quite minimal. The only thing Shrine requires from
you is that you call your preferred backgrounding library. This design is
intentional; background jobs should be declared in your application, not hidden
away in a library.

The way Shrine is designed makes it easy to know when the background job is
finished (changes are saved to the `<attachment>_data` column) so you can
easily degrade to the original cached file, or the versions generated in the
foreground (with the `recache` plugin).

The jobs are thread-safe in updating the `<attachment>_data` column, and they
adapt to changes in attachment or record being deleted. It's also easy to debug
failing jobs, since the cached file's data is given directly in job's
arguments.

## Conclusion

Making phases of file upload (caching, processing, storing, deleting)
asynchronous is essential for scaling and good user experience. However, in all
of the "mature" file upload libraries asynchronicity is either an incomplete
and flawed afterthought, or nonexistent (with the exception of Refile which at
least has direct uploads).

Shrine is the only file upload library with complete asynchronicity support
built-in. Its design allows you to use any backgrounding library, and the
implementation is robust and transparent.

[delayed_paperclip]: https://github.com/jrgifford/delayed_paperclip
[carrierwave_backgrounder]: https://github.com/lardawge/carrierwave_backgrounder
[carrierwave_direct]: https://github.com/dwilkie/carrierwave_direct
[paperdragon]: https://github.com/apotonick/paperdragon
[Shrine]: https://github.com/janko-m/shrine
[Refile]: https://github.com/refile/refile
[4 attachment columns]: https://github.com/thoughtbot/paperclip/blob/bd016009dbf74fc8f999e78a68c9e5869eb0dd6a/README.md#usage
[breaking CarrierWave's ability to remove attachments]: https://github.com/lardawge/carrierwave_backgrounder/pull/169
[open issue on Refile for adding backgrounding]: https://github.com/refile/refile/issues/167
