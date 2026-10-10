package com.parkingconcepts.mortimer

import android.app.Activity
import android.graphics.BitmapFactory
import android.graphics.drawable.BitmapDrawable
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import java.io.File
import java.util.zip.ZipFile

class ComicReaderActivity : Activity() {
    private var archive: File? = null
    private var zip: ZipFile? = null
    private var pages: List<String> = emptyList()
    private var pageIndex = 0
    private lateinit var image: ImageView
    private lateinit var status: TextView
    private lateinit var previousPage: Button
    private lateinit var nextPage: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val title = intent.getStringExtra(EXTRA_TITLE) ?: "Comic"
        try {
            val uri = intent.data ?: error("No file was provided.")
            archive = File(cacheDir, "comic_${System.currentTimeMillis()}.cbz").also { target ->
                contentResolver.openInputStream(uri)?.use { input ->
                    target.outputStream().use(input::copyTo)
                } ?: error("Could not read the file.")
            }
            zip = ZipFile(archive!!)
            pages = zip!!.entries().asSequence()
                .filter { !it.isDirectory && it.name.substringAfterLast('.', "").lowercase() in IMAGE_EXTENSIONS }
                .map { it.name }
                .sortedWith(compareBy<String> { naturalSortKey(it) }.thenBy { it.lowercase() })
                .toList()
            check(pages.isNotEmpty()) { "This CBZ contains no supported image pages." }

            val root = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(16, 16, 16, 16)
                setBackgroundColor(android.graphics.Color.rgb(7, 7, 10))
            }
            val heading = TextView(this).apply {
                text = title
                textSize = 18f
                setTextColor(android.graphics.Color.WHITE)
                gravity = Gravity.CENTER
            }
            status = TextView(this).apply {
                textSize = 13f
                setTextColor(android.graphics.Color.LTGRAY)
                gravity = Gravity.CENTER
                setPadding(0, 8, 0, 8)
            }
            image = ImageView(this).apply {
                adjustViewBounds = true
                scaleType = ImageView.ScaleType.FIT_CENTER
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
            }
            val controls = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER
            }
            previousPage = Button(this).apply { text = "← Previous"; setOnClickListener { showPage(pageIndex - 1) } }
            nextPage = Button(this).apply { text = "Next →"; setOnClickListener { showPage(pageIndex + 1) } }
            controls.addView(previousPage)
            controls.addView(nextPage)
            root.addView(heading)
            root.addView(status)
            root.addView(image)
            root.addView(controls)
            setContentView(root)
            val savedPage = getSharedPreferences("reading_progress", MODE_PRIVATE)
                .getInt(readingProgressKey(uri), 0)
            showPage(savedPage)
        } catch (error: Exception) {
            Toast.makeText(this, error.message ?: "Could not open the comic.", Toast.LENGTH_LONG).show()
            finish()
        }
    }

    private fun showPage(index: Int) {
        if (pages.isEmpty()) return
        val requestedIndex = index.coerceIn(0, pages.lastIndex)
        try {
            val entry = zip?.getEntry(pages[requestedIndex]) ?: error("Could not find this comic page.")
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            zip!!.getInputStream(entry).use { BitmapFactory.decodeStream(it, null, bounds) }
            check(bounds.outWidth > 0 && bounds.outHeight > 0) { "This comic page uses an unsupported or damaged image." }

            val targetWidth = (resources.displayMetrics.widthPixels - 32).coerceAtLeast(1)
            val targetHeight = (resources.displayMetrics.heightPixels * 0.72f).toInt().coerceAtLeast(1)
            var sample = 1
            while (bounds.outWidth / (sample * 2) >= targetWidth ||
                bounds.outHeight / (sample * 2) >= targetHeight) {
                if (sample > (1 shl 29)) break
                sample *= 2
            }
            val bitmap = zip!!.getInputStream(entry).use { stream ->
                BitmapFactory.decodeStream(stream, null, BitmapFactory.Options().apply { inSampleSize = sample })
            } ?: error("Could not decode this comic page.")

            val oldBitmap = (image.drawable as? BitmapDrawable)?.bitmap
            image.setImageBitmap(bitmap)
            if (oldBitmap != null && oldBitmap !== bitmap && !oldBitmap.isRecycled) oldBitmap.recycle()
            pageIndex = requestedIndex
            (intent.data ?: Uri.EMPTY).let { uri ->
                getSharedPreferences("reading_progress", MODE_PRIVATE).edit()
                    .putInt(readingProgressKey(uri), pageIndex).apply()
            }
            previousPage.isEnabled = pageIndex > 0
            nextPage.isEnabled = pageIndex < pages.lastIndex
            status.text = "Page ${pageIndex + 1} of ${pages.size}"
        } catch (error: Exception) {
            status.text = "Could not display page ${requestedIndex + 1}: ${error.message ?: "Unknown error"}"
            Toast.makeText(this, status.text, Toast.LENGTH_LONG).show()
        }
    }

    override fun onDestroy() {
        zip?.close()
        archive?.delete()
        super.onDestroy()
    }

    private fun readingProgressKey(uri: Uri): String = "comic_${uri.toString().hashCode()}"

    private fun naturalSortKey(path: String): String =
        Regex("""\d+""").replace(path.lowercase()) { match -> match.value.padStart(12, '0') }

    companion object {
        const val EXTRA_TITLE = "comic_title"
        private val IMAGE_EXTENSIONS = setOf("jpg", "jpeg", "png", "webp", "gif")
    }
}
