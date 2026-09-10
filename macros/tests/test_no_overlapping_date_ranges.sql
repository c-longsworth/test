{% test no_overlapping_date_ranges(model, partition_by, valid_from='valid_from', valid_to='valid_to') %}

{#-
    Ranges are half-open: valid_to is exclusive, open-ended is 9999-12-31.
    Two rows covering the same month for one key means the pool is allocated
    twice; a gap means a month falls through to the coverage-gap path. Both are
    silent at query time.
-#}

with ranges as (

    select distinct
        {{ partition_by | join(',\n        ') }},
        {{ valid_from }} as valid_from,
        {{ valid_to }}   as valid_to
    from {{ model }}

)

select a.*
from ranges a
join ranges b
    on {% for col in partition_by %}a.{{ col }} = b.{{ col }}
   and {% endfor %}(a.valid_from <> b.valid_from or a.valid_to <> b.valid_to)
where {{ mc_date_range_overlaps('a.valid_from', 'a.valid_to', 'b.valid_from', 'b.valid_to') }}

{% endtest %}
