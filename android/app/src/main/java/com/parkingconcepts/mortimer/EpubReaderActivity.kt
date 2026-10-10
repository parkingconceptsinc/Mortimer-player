package com.parkingconcepts.mortimer

import android.app.Activity
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.text.Html
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.io.File
import java.util.zip.ZipFile

class EpubReaderActivity : Activity() {
    private var archive: File? = null
    private var zip: ZipFile? = null
    private var chapters: List<Pair<String, String>> = emptyList()
    private var chapterIndex = 0
    private lateinit var heading: TextView
    private lateinit var body: TextView
    private lateinit var scroll: ScrollView
    private lateinit var previousChapter: Button
    private lateinit var nextChapter: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            val uri = intent.data ?: error("No EPUB file was provided.")
            archive = File(cacheDir, "book_${System.currentTimeMillis()}.epub").also { target ->
                contentResolver.openInputStream(uri)?.use { input -> target.outputStream().use { output -> input.copyTo(output) } }
                    ?: error("Could not read the EPUB file.")
            }
            zip = ZipFile(archive!!)
            val container = zip!!.getInputStream(zip!!.getEntry("META-INF/container.xml") ?: error("Invalid EPUB file."))
                .bufferedReader().use { it.readText() }
            val opfPath = Regex("""full-path\s*=\s*["']([^"']+)["']""").find(container)?.groupValues?.get(1)
                ?: error("Could not find the EPUB package document.")
            val opf = zip!!.getInputStream(zip!!.getEntry(opfPath) ?: error("The OPF file is missing."))
                .bufferedReader().use { it.readText() }
            val base = opfPath.substringBeforeLast('/', "")
            val manifest = Regex("""<item\b([^>]+?)/?>""", RegexOption.IGNORE_CASE).findAll(opf).mapNotNull { match ->
                val attrs = match.groupValues[1]
                val id = Regex("""\bid\s*=\s*["']([^"']+)["']""").find(attrs)?.groupValues?.get(1)
                val href = Regex("""\bhref\s*=\s*["']([^"']+)["']""").find(attrs)?.groupValues?.get(1)
                if (id != null && href != null && (href.endsWith(".xhtml", true) || href.endsWith(".html", true) || href.endsWith(".htm", true))) {
                    id to (if (base.isEmpty()) href else "$base/$href").replace("/./", "/")
                } else null
            }.toMap()
            val spine = Regex("""<itemref\b[^>]*\bidref\s*=\s*["']([^"']+)["'][^>]*/?>""", RegexOption.IGNORE_CASE)
                .findAll(opf).mapNotNull { manifest[it.groupValues[1]] }.toList()
            // Keep only chapter paths and lightweight labels in memory. Load chapter text on demand.
            chapters = spine.mapNotNull { path ->
                if (zip!!.getEntry(path) == null) return@mapNotNull null
                val label = path.substringAfterLast('/').substringBeforeLast('.')
                    .replace(Regex("[-_]"), " ").ifBlank { "Chapter" }
                path to label
            }
            check(chapters.isNotEmpty()) { "This EPUB contains no supported chapters." }
            buildLayout()
            val uriForProgress = intent.data ?: Uri.EMPTY
            val savedChapter = getSharedPreferences("reading_progress", MODE_PRIVATE)
                .getInt(readingProgressKey(uriForProgress), 0)
            showChapter(savedChapter)
        } catch (error: Exception) {
            Toast.makeText(this, error.message ?: "Could not open the EPUB.", Toast.LENGTH_LONG).show()
            finish()
        }
    }

    private fun htmlToText(html: String): CharSequence {
        val cleaned = html.replace(Regex("(?is)<(script|style)[^>]*>.*?</\\1>"), "")
        return Html.fromHtml(cleaned, Html.FROM_HTML_MODE_COMPACT)
    }

    private fun buildLayout() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(12), dp(16), dp(12))
            setBackgroundColor(Color.rgb(7, 7, 10))
        }
        heading = TextView(this).apply {
            textSize = 18f; maxLines = 2; setTextColor(Color.rgb(255, 120, 73)); gravity = Gravity.CENTER
        }
        scroll = ScrollView(this)
        body = TextView(this).apply {
            textSize = 18f; setTextColor(Color.rgb(240, 240, 244)); setLineSpacing(dp(4).toFloat(), 1f)
            setPadding(0, dp(18), 0, dp(18))
        }
        scroll.addView(body)
        val controls = LinearLayout(this).apply { gravity = Gravity.CENTER }
        previousChapter = Button(this).apply {
            text = "← Previous"
            textSize = 12f
            minWidth = 0
            setPadding(dp(4), dp(4), dp(4), dp(4))
            setOnClickListener { showChapter(chapterIndex - 1) }
        }
        nextChapter = Button(this).apply {
            text = "Next →"
            textSize = 12f
            minWidth = 0
            setPadding(dp(4), dp(4), dp(4), dp(4))
            setOnClickListener { showChapter(chapterIndex + 1) }
        }
        controls.addView(previousChapter, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        controls.addView(nextChapter, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        root.addView(heading)
        root.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(controls)
        setContentView(root)
    }

    private fun showChapter(index: Int) {
        if (chapters.isEmpty()) return
        val targetIndex = index.coerceIn(0, chapters.lastIndex)
        val (path, label) = chapters[targetIndex]
        try {
            val entry = zip?.getEntry(path) ?: error("Chapter file is missing.")
            val html = zip!!.getInputStream(entry).bufferedReader().use { it.readText() }
            val title = Regex("""<title[^>]*>(.*?)</title>""", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
                .find(html)?.groupValues?.get(1)?.replace(Regex("<[^>]+>"), "")?.trim()?.takeIf { it.isNotEmpty() }
                ?: label
            val renderedContent = htmlToText(html)

            // Commit the new position only after the chapter has been read and rendered.
            body.text = renderedContent
            heading.text = "$title  ·  ${targetIndex + 1} of ${chapters.size}"
            scroll.scrollTo(0, 0)
            chapterIndex = targetIndex
            previousChapter.isEnabled = chapterIndex > 0
            nextChapter.isEnabled = chapterIndex < chapters.lastIndex
            (intent.data ?: Uri.EMPTY).let { uri ->
                getSharedPreferences("reading_progress", MODE_PRIVATE).edit()
                    .putInt(readingProgressKey(uri), chapterIndex).apply()
            }
        } catch (error: Exception) {
            // Keep the last successfully displayed chapter as the navigation/progress position.
            heading.text = "Chapter ${targetIndex + 1} could not be loaded"
            body.text = error.message ?: "The chapter could not be read."
            previousChapter.isEnabled = chapterIndex > 0
            nextChapter.isEnabled = chapterIndex < chapters.lastIndex
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun readingProgressKey(uri: Uri): String = "epub_${uri.toString().hashCode()}"

    override fun onDestroy() {
        zip?.close()
        archive?.delete()
        super.onDestroy()
    }
}
