namespace Uprooted.Tests;

public class ColorUtilsTests
{
    // === ParseHex / ToHex round-trip ===

    [Theory]
    [InlineData("#FF0000", 255, 0, 0)]
    [InlineData("#00FF00", 0, 255, 0)]
    [InlineData("#0000FF", 0, 0, 255)]
    [InlineData("#FFFFFF", 255, 255, 255)]
    [InlineData("#000000", 0, 0, 0)]
    [InlineData("#3B6AF8", 59, 106, 248)]
    [InlineData("#A46565", 164, 101, 101)]
    public void ParseHex_ReturnsCorrectRgb(string hex, byte r, byte g, byte b)
    {
        var (pr, pg, pb) = ColorUtils.ParseHex(hex);
        Assert.Equal(r, pr);
        Assert.Equal(g, pg);
        Assert.Equal(b, pb);
    }

    [Theory]
    [InlineData(255, 0, 0, "#FF0000")]
    [InlineData(0, 255, 0, "#00FF00")]
    [InlineData(0, 0, 255, "#0000FF")]
    [InlineData(59, 106, 248, "#3B6AF8")]
    public void ToHex_ReturnsCorrectString(byte r, byte g, byte b, string expected)
    {
        Assert.Equal(expected, ColorUtils.ToHex(r, g, b));
    }

    // === IsValidHex ===

    [Theory]
    [InlineData("#FF0000", true)]
    [InlineData("#3B6AF8", true)]
    [InlineData("#000000", true)]
    [InlineData("#ffffff", true)]
    [InlineData("#FFF", false)]      // 3-char not supported
    [InlineData("FF0000", false)]    // Missing #
    [InlineData("#GGGGGG", false)]   // Invalid hex chars
    [InlineData(null, false)]
    [InlineData("", false)]
    public void IsValidHex_ValidatesCorrectly(string? hex, bool expected)
    {
        Assert.Equal(expected, ColorUtils.IsValidHex(hex));
    }

    // === HSV round-trip ===

    [Theory]
    [InlineData("#FF0000", 0, 1.0, 1.0)]       // Pure red
    [InlineData("#00FF00", 120, 1.0, 1.0)]      // Pure green
    [InlineData("#0000FF", 240, 1.0, 1.0)]      // Pure blue
    [InlineData("#FFFFFF", 0, 0.0, 1.0)]        // White (hue undefined, 0)
    [InlineData("#000000", 0, 0.0, 0.0)]        // Black
    public void RgbToHsv_KnownColors(string hex, double expH, double expS, double expV)
    {
        var (h, s, v) = ColorUtils.RgbToHsv(hex);
        Assert.Equal(expH, h, 1);  // 1 decimal tolerance
        Assert.Equal(expS, s, 2);
        Assert.Equal(expV, v, 2);
    }

    [Theory]
    [InlineData(0, 1.0, 1.0, "#FF0000")]     // Pure red
    [InlineData(120, 1.0, 1.0, "#00FF00")]   // Pure green
    [InlineData(240, 1.0, 1.0, "#0000FF")]   // Pure blue
    [InlineData(60, 1.0, 1.0, "#FFFF00")]    // Yellow
    [InlineData(180, 1.0, 1.0, "#00FFFF")]   // Cyan
    [InlineData(300, 1.0, 1.0, "#FF00FF")]   // Magenta
    public void HsvToHex_PureColors(double h, double s, double v, string expected)
    {
        Assert.Equal(expected, ColorUtils.HsvToHex(h, s, v));
    }

    [Fact]
    public void PureHueHex_MatchesHsvToHex()
    {
        for (double h = 0; h < 360; h += 30)
        {
            Assert.Equal(ColorUtils.HsvToHex(h, 1.0, 1.0), ColorUtils.PureHueHex(h));
        }
    }

    [Theory]
    [InlineData("#FF0000")]
    [InlineData("#00FF00")]
    [InlineData("#0000FF")]
    [InlineData("#3B6AF8")]
    [InlineData("#A46565")]
    [InlineData("#2D7D46")]
    [InlineData("#C42B1C")]
    public void HsvRoundTrip_PreservesColor(string hex)
    {
        var (h, s, v) = ColorUtils.RgbToHsv(hex);
        var result = ColorUtils.HsvToHex(h, s, v);
        // Allow ±1 in each channel due to floating point
        var (r1, g1, b1) = ColorUtils.ParseHex(hex);
        var (r2, g2, b2) = ColorUtils.ParseHex(result);
        Assert.InRange(Math.Abs(r1 - r2), 0, 1);
        Assert.InRange(Math.Abs(g1 - g2), 0, 1);
        Assert.InRange(Math.Abs(b1 - b2), 0, 1);
    }

    // === HSL round-trip ===

    [Theory]
    [InlineData("#FF0000")]
    [InlineData("#00FF00")]
    [InlineData("#0000FF")]
    [InlineData("#3B6AF8")]
    [InlineData("#A46565")]
    public void HslRoundTrip_PreservesColor(string hex)
    {
        var (h, s, l) = ColorUtils.RgbToHsl(hex);
        var result = ColorUtils.HslToHex(h, s, l);
        var (r1, g1, b1) = ColorUtils.ParseHex(hex);
        var (r2, g2, b2) = ColorUtils.ParseHex(result);
        Assert.InRange(Math.Abs(r1 - r2), 0, 1);
        Assert.InRange(Math.Abs(g1 - g2), 0, 1);
        Assert.InRange(Math.Abs(b1 - b2), 0, 1);
    }

    // === Darken / Lighten ===

    [Fact]
    public void Darken_ReducesBrightness()
    {
        var result = ColorUtils.Darken("#FF0000", 50);
        var (r, g, b) = ColorUtils.ParseHex(result);
        Assert.Equal(128, r);
        Assert.Equal(0, g);
        Assert.Equal(0, b);
    }

    [Fact]
    public void Lighten_IncreaseBrightness()
    {
        var result = ColorUtils.Lighten("#000000", 50);
        var (r, g, b) = ColorUtils.ParseHex(result);
        Assert.Equal(128, r);
        Assert.Equal(128, g);
        Assert.Equal(128, b);
    }

    // === Alpha ===

    [Fact]
    public void WithAlpha_ProducesARGBFormat()
    {
        var result = ColorUtils.WithAlpha("#FF0000", 128);
        Assert.Equal("#80FF0000", result);
    }

    [Fact]
    public void WithAlphaFraction_ConvertsCorrectly()
    {
        var result = ColorUtils.WithAlphaFraction("#FF0000", 0.5);
        Assert.Equal("#80FF0000", result);
    }

    // === Mix ===

    [Fact]
    public void Mix_HalfwayBetween()
    {
        var result = ColorUtils.Mix("#000000", "#FFFFFF", 0.5);
        var (r, g, b) = ColorUtils.ParseHex(result);
        Assert.InRange(r, 127, 128);
        Assert.InRange(g, 127, 128);
        Assert.InRange(b, 127, 128);
    }

    // === DeriveTextColor ===

    [Fact]
    public void DeriveTextColor_LightOnDark()
    {
        var text = ColorUtils.DeriveTextColor("#0D1521");
        var (_, _, l) = ColorUtils.RgbToHsl(text);
        Assert.True(l > 0.8, "Text on dark bg should be light");
    }

    [Fact]
    public void DeriveTextColor_DarkOnLight()
    {
        var text = ColorUtils.DeriveTextColor("#F0F0F0");
        var (_, _, l) = ColorUtils.RgbToHsl(text);
        Assert.True(l < 0.2, "Text on light bg should be dark");
    }
}
