namespace DataAccess.Entities
{
    public class CenapredData
    {
        private static Dictionary<DateTime, CenapredData> _cache = new Dictionary<DateTime, CenapredData>();

        public int UsageCount { get; set; }

        public int Exhalations { get; set; }

        public string Phase { get; set; }

        public string DirectionOfPlume { get; set; }

        public static CenapredData? TryGetData(DateTime date)
        {
            var timelessDate = date.Date;
            if (_cache.ContainsKey(timelessDate))
            {
                _cache[timelessDate].UsageCount++;
                return _cache[timelessDate];
            }

            var data = CenapredScraper.Scrape(timelessDate);

            if (data != null)
            {
                if (_cache.Count == 7)
                {
                    var leastUsed = _cache.OrderBy(d => d.Value.UsageCount).First().Key;

                    _cache.Remove(leastUsed);
                }

                _cache.Add(timelessDate, data);
            }

            return data;
        }        
    }
}
